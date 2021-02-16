const dateFormat = require('dateformat');
const sendGridEmail = require("../utils/transport");
const { sortByPopularity } = require("../utils/popularity-algorithms");
const {cloudUpload, cloudDelete} = require('../services/cloudinary');

const User = require('../models/user');
const Notification = require('../models/message');
const Course = require('../models/course');
const PostComment = require('../models/postComment');
const Room = require('../models/room');

module.exports.index = async function(req, res) {
    const courses = await Course.find({});
    if (!courses) {
        req.flash('error', "Unable to find courses");
        return res.redirect('back');
    }

    let courseList = [];
    let userIncluded;
    for (let course of courses) {
        if ((course.teacher.equals(req.user._id)) || (course.students.includes(req.user._id))) {
            courseList.push(course);

        } else {
            for (let tutor of course.tutors) {
                if (tutor.tutor.equals(req.user._id)) {
                    courseList.push(course);
                }
            }
        }
    }

    return res.render('homework/index', {courses: courseList});
}

module.exports.createCourse = async function(req, res) {
    let charSetMatrix = [];
    charSetMatrix.push('qwertyuiopasdfghjklzxcvbnm'.split(''));
    charSetMatrix.push('QWERTYUIOPASDFGHJKLZXCVBNM'.split(''));
    charSetMatrix.push('1234567890'.split(''));

    let code_length = Math.round((Math.random() * 15)) + 10;
    let joinCode = "";

    let charSet; //Which character set to choose from
    for (let i = 0; i < code_length; i++) {
        charSet = charSetMatrix[Math.floor(Math.random() * 3)];
        joinCode += charSet[Math.floor((Math.random() * charSet.length))];
    }

    const course = await Course.create({ //Create course with specified information
        name: req.body.title,
        thumbnail: {url: req.body.thumbnail, display: req.body.showThumbnail == "url"},
        joinCode,
        description: req.body.description,
        active: true,
        teacher: req.user
    });

    if (!course) {
        req.flash('error', "Unable to create course");
        return res.redirect('back');
    }

    if (req.files) {
        if (req.files.imageFile) {
            let [cloudErr, cloudResult] = await cloudUpload(req.files.imageFile[0], "image");
            if (cloudErr || !cloudResult) {
                req.flash("error", "Upload failed");
                return res.redirect("back");
            }
            course.thumbnailFile = {
                filename: cloudResult.public_id,
                url: cloudResult.secure_url,
                originalName: req.files.imageFile[0].originalname,
                display: req.body.showThumbnail == "upload"
            };
            await course.save();
        }
    }
    req.flash('success', "Successfully created course");
    return res.redirect('/homework');
}

//Join as tutor or as student
module.exports.joinCourse = async function(req, res) {
    if (req.body.bio) { //Join as tutor
        if (req.user.tags.includes("Tutor")) {
            const course = await Course.findOne({joinCode: req.body.joincode});
            if (!course) {
                req.flash('error', "No courses matching this join code were found.");
                return res.redirect('back');
            }

            course.tutors.push({
                tutor: req.user,
                bio: req.body.bio,
                slots: parseInt(req.body.slots),
                available: (parseInt(req.body.slots) > 0),
                dateJoined: new Date(Date.now())
            });
            await course.save();
            req.flash('success', `Successfully joined ${course.name} as a tutor!`);
            return res.redirect(`/homework/${course._id}`);
        }
        req.flash('error', `You do not have permission to do that`);
        return res.redirect(`back`);
    }

    //Join as student
    if (['7th', '8th', '9th', '10th', '11th', '12th'].includes(req.user.status)) {
        const course = await Course.findOne({joinCode: req.body.joincode});
        if (!course) {
            req.flash('error', "No courses matching this join code were found.");
            return res.redirect('back');
        }

        course.students.push(req.user);
        await course.save();
        req.flash('success', `Successfully joined ${course.name}!`);
        return res.redirect(`/homework/${course._id}`);
    }
    req.flash('error', `You do not have permission to do that`);
    return res.redirect(`back`);
}

module.exports.showCourse = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('teacher students tutors.tutor tutors.reviews.review blocked');
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    let studentIds = []; //Collect info on the ids of all students and tutors in the course
    let tutorIds = [];
    let tutors = [];
    for (let student of course.students) {
        studentIds.push(student._id.toString());
    }

    let averageRating = 0;
    let tutorObject = {};
    for (let tutor of course.tutors) {
        averageRating = 0;
        tutorObject = {};
        tutorIds.push(tutor.tutor._id.toString());
        for (let review of tutor.reviews) {
            averageRating += review.rating;
        }
        averageRating = Math.round(averageRating / tutor.reviews.length);
        tutorObject = tutor;
        tutorObject.averageRating = averageRating;
        tutors.push(tutorObject)
    }

    tutors = await sortByPopularity(tutors, "averageRating", "dateJoined", null).unpopular
    .concat(sortByPopularity(tutors, "averageRating", "dateJoined", null).popular);

    tutors = await sortByPopularity(tutors, "reviews", "dateJoined", null).unpopular
    .concat(sortByPopularity(tutors, "reviews", "dateJoined", null).popular);

    const teachers = await User.find({authenticated: true, status: "faculty", _id: {$ne: req.user._id}});
    if (!teachers) {
        req.flash('error', "Unable to find teachers");
        return res.redirect('back');
    }
    return res.render('homework/show', {course, studentIds, tutorIds, tutors, teachers});
}

module.exports.unenrollStudent = async function(req, res) {
    const course = await Course.findByIdAndUpdate(req.params.id, {$pull: {students: req.user._id}}).populate("tutors.tutor");
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    //Remove user from all tutors they have signed up with, and delete corresponding chat rooms
    let deletedRoom;
    for (let tutor of course.tutors) {
        if (tutor.students.includes(req.user._id)) { //Update the tutor's students array
            tutor.formerStudents.push(req.user._id);
            tutor.students.splice(tutor.students.indexOf(req.user._id), 1);
            tutor.slots++;
            tutor.available = true;

            for (let i = 0; i < tutor.rooms.length; i++) { //Update the tutor's rooms array
                if (tutor.rooms[i].student.equals(req.user._id)) {
                    deletedRoom = await Room.findByIdAndDelete(tutor.rooms[i].room);

                    if (!deletedRoom) {
                        req.flash('error', "Unable to find room");
                        return res.redirect('back');
                    }

                    if (req.user.newRoomCount.includes(deletedRoom._id)) {
                        req.user.newRoomCount.splice(req.user.newRoomCount.indexOf(deletedRoom._id), 1);
                        await req.user.save();
                    }

                    if (tutor.tutor.newRoomCount.includes(deletedRoom._id)) {
                        tutor.tutor.newRoomCount.splice(tutor.tutor.newRoomCount.indexOf(deletedRoom._id), 1);
                        await tutor.tutor.save();
                    }

                    tutor.rooms.splice(i, 1);
                }
            }
        }
    }

    await course.save();
    req.flash('success', `Unenrolled from ${course.name}!`);
    return res.redirect('/homework');
}

module.exports.unenrollTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.rooms.student');
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    for (let i = course.tutors.length - 1; i >= 0; i--) {
        if (course.tutors[i].tutor._id.equals(req.user._id)) { //If the selected tutor is the current user
            let deletedRoom;
            for (let room of course.tutors[i].rooms) {
                deletedRoom = await Room.findByIdAndDelete(room.room);
                if (!deletedRoom) {
                    req.flash('error', "Unable to remove chat room");
                    return res.redirect('back');
                }

                if (room.student.newRoomCount.includes(deletedRoom._id)) {
                    room.student.newRoomCount.splice(room.student.newRoomCount.indexOf(deletedRoom._id), 1);
                    await room.student.save();
                }

                if (req.user.newRoomCount.includes(deletedRoom._id)) {
                    req.user.newRoomCount.splice(req.user.newRoomCount.indexOf(deletedRoom._id), 1);
                    await req.user.save();
                }
            }
            course.tutors.splice(i, 1); //Remove tutor from course
            break;
        }
    }
    await course.save();
    req.flash('success', `Unenrolled from ${course.name}!`);
    return res.redirect('/homework');
}

module.exports.updateSettings = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        req.flash("error", "An error occurred");
        return res.redirect("back");
    }

    for (let attr in req.body) { //Iterate through each of the data's keys and update the course with the corresponding value
        if (attr != "thumbnail") {
            if (req.body[attr].split(' ').join('') != '') {
                course[attr] = req.body[attr];
            }
        }
    }

    if (req.body.thumbnail.split(' ').join('') != '') {
        course.thumbnail = {url: req.body.thumbnail, display: req.body.showThumbnail == "url"};
    }
    course.thumbnailFile.display = req.body.showThumbnail == "upload";

    if (req.files) {
        let cloudErr;
        let cloudResult;
        if (course.thumbnailFile.filename) {
            [cloudErr, cloudResult] = await cloudDelete(course.thumbnailFile.filename, "image");
            if (cloudErr || !cloudResult) {
                req.flash("error", "Error deleting uploaded image");
                return res.redirect("back");
            }
        }

        if (req.files.imageFile) {
            [cloudErr, cloudResult] = await cloudUpload(req.files.imageFile[0], "image");
            if (cloudErr || !cloudResult) {
                req.flash("error", "Upload failed");
                return res.redirect("back");
            }
            course.thumbnailFile = {
                filename: cloudResult.public_id,
                url: cloudResult.secure_url,
                originalName: req.files.imageFile[0].originalname,
                display: req.body.showThumbnail == "upload"
            };
        }
    }

    await course.save();
    req.flash("success", "Updated course settings")
    return res.redirect(`/homework/${course._id}`);
}

module.exports.deleteCourse = async function(req, res) {
    const course = await Course.findOne({_id: req.params.id, joinCode: req.body.joinCode})
    .populate("tutors.tutor tutors.students tutors.rooms.student");
    if (!course) {
        req.flash("error", "Incorrect join code");
        return res.redirect("back");
    }

    let deletedRoom;
    for (let tutor of course.tutors) {
        for (let room of tutor.rooms) {
            deletedRoom = await Room.findByIdAndDelete(room.room);
            if (!deletedRoom) {
                req.flash("error", "Unable to find room");
                return res.redirect("back");
            }

            if (tutor.tutor.newRoomCount.includes(room.room)) {
                tutor.tutor.newRoomCount.splice(tutor.tutor.newRoomCount.indexOf(room.room), 1);
                await tutor.tutor.save();
            }

            if (room.student.newRoomCount.includes(room.room)) {
                room.student.newRoomCount.splice(room.student.newRoomCount.indexOf(room.room), 1);
                await room.student.save();
            }
        }
    }

    const deletedCourse = await Course.findByIdAndDelete(course._id);
    if (!deletedCourse) {
        req.flash("error", "Unable to delete course");
        return res.redirect("back");
    }

    req.flash("success", `Deleted ${course.name}!`);
    return res.redirect("/homework");
}

//-----------TEACHER ROUTES -----------//

module.exports.updateTeacher = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        req.flash("error", "Unable to find course");
        return res.redirect("back");
    }

    if (!(course.joinCode == req.body.joinCodeConfirm)) {
        req.flash("error", "Join code is invalid");
        return res.redirect("back");
    }

    const newTeacher = await User.findById(req.body.teacher);
    if (!newTeacher) {
        req.flash("error", "Error finding teacher");
        return res.redirect("back");
    }

    course.teacher = newTeacher;
    await course.save();
    req.flash("success", "Updated course teacher!");
    return res.redirect("/homework");
}

module.exports.updateJoinCode = async function(req, res) {
    let charSetMatrix = [];
    charSetMatrix.push('qwertyuiopasdfghjklzxcvbnm'.split(''));
    charSetMatrix.push('QWERTYUIOPASDFGHJKLZXCVBNM'.split(''));
    charSetMatrix.push('1234567890'.split(''));

    let code_length = Math.round((Math.random() * 15)) + 10;
    let joinCode = "";

    let charSet;
    for (let i = 0; i < code_length; i++) {
        charSet = charSetMatrix[Math.floor(Math.random() * 3)];
        joinCode += charSet[Math.floor((Math.random() * charSet.length))];
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "An Error Occurred"});
    }

    course.joinCode = joinCode;
    await course.save();
    return res.json({success: "Succesfully Updated Join Code", joinCode});
}

module.exports.removeStudent = async function(req, res) {
    const studentId = await User.findById(req.body.studentId);
    if (!studentId) {
        return res.json({error: "Error removing student"});
    }

    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.rooms.student');
    if (!course) {
        return res.json({error: "Error removing student"});
    }

    let deletedRoom;
    for (let tutor of course.tutors) {
        if (tutor.students.includes(studentId._id)) { //For all tutors that have this student
            tutor.formerStudents.push(studentId._id);
            tutor.students.splice(tutor.students.indexOf(studentId._id), 1); //Remove student from tutor

            for (let i = 0; i < tutor.rooms.length; i++) { //Remove all rooms in this student's name
                if (tutor.rooms[i].student._id.equals(studentId._id)) {
                    deletedRoom = await Room.findByIdAndDelete(tutor.rooms[i].room);
                    if (!deletedRoom) {
                        return res.json({error: "Error removing tutor"});
                    }

                    if (tutor.rooms[i].student.newRoomCount.includes(deletedRoom._id)) { //Update tutor's and student's newRoomCount
                        tutor.rooms[i].student.newRoomCount.splice(tutor.rooms[i].student.newRoomCount.indexOf(deletedRoom._id), 1);
                        await tutor.rooms[i].student.save();
                    }

                    if (tutor.tutor.newRoomCount.includes(deletedRoom._id)) {
                        tutor.tutor.newRoomCount.splice(tutor.tutor.newRoomCount.indexOf(deletedRoom._id), 1);
                        await tutor.tutor.save();
                    }
                }

                tutor.rooms.splice(i, 1); //Officially remove room from tutor
            }
        }
    }

    const notif = await Notification.create({  //Create a notification to alert the user
        subject: `Removal from ${course.name}`,
        text: `You were removed from ${course.name} for the following reason:\n"${req.body.reason}"`,
        sender: req.user,
        noReply: true,
        recipients: [studentId],
        read: [],
        mages: []
    });

    if (!notif) {
        return res.json({error: "Error removing student"});
    }

    notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
    await notif.save()
    studentId.inbox.push(notif);
    studentId.msgCount++;
    await studentId.save();
    if (studentId.receiving_emails) {
        await sendGridEmail(studentId.email, `Removal from ${course.name}`, `<p>Hello ${studentId.firstName},</p><p>${notif.text}</p>`, false);
    }
    course.blocked.push(studentId);

    for (let i = 0; i < course.students.length; i++) {
        if (course.students[i]._id.equals(studentId._id)) {
            course.students.splice(i, 1);
            await course.save();
            return res.json({success: "Succesfully removed student", student: studentId, course});
        }
    }
}

module.exports.removeTutor = async function(req, res) {
    let tutorId;
    if (req.body.show) {
        tutorId = await User.findById(req.body.tutorId);
        if (!tutorId) {
            return res.json({error: "Error removing tutor"});
        }

    } else {
        tutorId = await User.findById(req.query.tutorId);
        if (!tutorId) {
            req.flash("error", "Error removing tutor");
            return res.redirect("back");
        }
    }

    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.rooms.student');
    if (!course) {
        if (req.body.show) {
            return res.json({error: "Error removing tutor"});
        } else {
            req.flash("error", "Error removing tutor");
            return res.redirect("back");
        }
    }

    for (let i = 0; i < course.tutors.length; i++) {
        if (course.tutors[i].tutor._id.equals(tutorId._id)) {
            let deletedRoom;
            for (let room of course.tutors[i].rooms) { //For all of the tutor's rooms, remove room and update students' new room counts
                deletedRoom = await Room.findByIdAndDelete(room.room);
                if (!deletedRoom) {
                    if (req.body.show) {
                        return res.json({error: "Error removing tutor"});
                    } else {
                        req.flash("error", "Error removing tutor");
                        return res.redirect("back");
                    }
                }

                if (room.student.newRoomCount.includes(deletedRoom._id)) {
                    room.student.newRoomCount.splice(room.student.newRoomCount.indexOf(deletedRoom._id), 1);
                    await room.student.save();
                }

                if (tutorId.newRoomCount.includes(deletedRoom._id)) {
                    tutorId.newRoomCount.splice(tutorId.newRoomCount.indexOf(deletedRoom._id), 1);
                }
            }

            const notif = await Notification.create({ //Create a notification to alert tutor that they have been removed
                subject: `Removal from ${course.name}`,
                text: `You were removed from ${course.name} for the following reason:\n"${req.body.reason}"`,
                sender: req.user,
                noReply: true,
                recipients: [tutorId],
                read: [],
                images: []
            });

            if (!notif) {
                if (req.body.show) {
                    return res.json({error: "Error removing tutor"});
                } else {
                    req.flash("error", "Error removing tutor");
                    return res.redirect("back");
                }
            }

            notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
            await notif.save();

            tutorId.inbox.push(notif);
            tutorId.msgCount++;
            await tutorId.save();
            if (tutorId.receiving_emails) {
                await sendGridEmail(tutorId.email, `Removal from ${course.name}`, `<p>Hello ${tutorId.firstName},</p><p>${notif.text}</p>`, false);
            }

            course.blocked.push(tutorId); //Remove tutor and block them
            course.tutors.splice(i, 1);
            await course.save();

            if (req.body.show) {
                return res.json({success: "Succesfully removed tutor", tutor: tutorId, course});
            } else {
                req.flash("success", "Succesfully Removed Tutor!");
                return res.redirect(`/homework/${course._id}`);
            }
        }
    }
}

module.exports.unblock = async function(req, res) {
    const blockedId = await User.findById(req.body.blockedId);
    if (!blockedId) {
        return res.json({error: "Unable to access user"});
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Unable to access course"});
    }

    if (!course.blocked.includes(blockedId._id)) { //If the user is not blocked, they cannot be unblocked
        return res.json({error: "User is not blocked from this course"});
    }

    course.blocked.splice(course.blocked.indexOf(blockedId._id), 1); //Unblock user
    await course.save();

    const notif = await Notification.create({  //Create a notification to alert the user
        subject: `Unblocked from ${course.name}`,
        text: `You have been unblocked from ${course.name}. You can rejoin with the join code now whenever you need to.`,
        sender: req.user,
        noReply: true,
        recipients: [blockedId],
        read: [],
        images: []
    });

    if (!notif) {
        return res.json({error: "Error removing student"});
    }

    notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
    await notif.save();

    blockedId.inbox.push(notif);
    blockedId.msgCount++;
    await blockedId.save();
    if (blockedId.receiving_emails) {
        await sendGridEmail(blockedId.email, `Removal from ${course.name}`, `<p>Hello ${blockedId.firstName},</p><p>${notif.text}</p>`, false);
    }
    return res.json({success: "Succesfully unblocked user", blocked: blockedId, course});
}

//-----------TUTOR ROUTES -----------//

module.exports.updateBio = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Unable to find course"});
    }

    for (let tutor of course.tutors) { //Iterate through tutors and search for current user
        if (tutor.tutor.equals(req.user._id)) {
            tutor.bio = req.body.bio;
            await course.save();
            return res.json({success: "Successfully changed"})
        }
    }
}

module.exports.closeLessons = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error closing lessons"});
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.user._id)) { //If the selected tutor matches the current user, shut down availability
            tutor.available = false;
            await course.save();
            return res.json({success: "Successfully closed lessons"});
        }
    }
}

module.exports.reopenLessons = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error closing lessons"});
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.user._id)) { //If the selected tutor matches the current user, reopen availability
            tutor.available = true;
            await course.save();
            return res.json({success: "Successfully closed lessons"});
        }
    }
}

module.exports.setStudents = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error accessing course"});
    }

    let found = false;
    for (let tutor of course.tutors) { //Search through tutors to find requested tutor
        if (tutor.tutor.equals(req.user._id)) {
            found = true;
            tutor.slots = parseInt(req.body.slots) - tutor.students.length; //Update slots based on data
            if ((parseInt(req.body.slots) - tutor.students.length) == 0) { //Update availability based on new slot info
                tutor.available = false;
            }

            await course.save();
            return res.json({success: "Succesfully changed", tutor});
        }
    }

    if (!found) {
        return res.json({error: "Unable to find tutor"});
    }
}

module.exports.markLesson = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error accessing course"});
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.user._id)) {
            const studentId = await User.findById(req.body.studentId);
            if (!studentId) {
                return res.json({error: "Error accessing student"});
            }

            if (tutor.tutor.equals(req.user._id)) {
                const lessonObject = {
                    student: studentId._id,
                    time: req.body.time,
                    date: dateFormat(new Date(), "mmm d"),
                    summary: req.body.summary
                };

                tutor.lessons.push(lessonObject);
                await course.save();
                return res.json({success: "Succesfully updated", lesson: lessonObject, student: studentId, tutor});
            }
        }
    }
}

//-----------STUDENT ROUTES -----------//

module.exports.bookTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor');
    if (!course) {
        return res.json({error: "Error accessing course"});
    }

    let formerStudent = false;
    for (let tutor of course.tutors) { //Iterate through tutors and search for the corresponding one
        if (tutor.tutor._id.equals(req.body.tutorId) && tutor.available) {
            tutor.students.push(req.user._id);

            if (tutor.formerStudents.includes(req.user._id)) { //Remove student from tutor's former students (if they were there)
                formerStudent = true;
                tutor.formerStudents.splice(tutor.formerStudents.indexOf(req.user._id), 1);
            }

            tutor.slots--;
            if (tutor.slots == 0) {
                tutor.available = false;
            }

            const room = await Room.create({ //Create chat room between student and tutor
                name: `${req.user.firstName}'s Tutoring Sessions With ${tutor.tutor.firstName} - ${course.name}`,
                creator: {id: tutor.tutor._id, username: tutor.tutor.username},
                members: [req.user._id, tutor.tutor._id],
                type: "private",
                mutable: false
            });

            if (!room) {
                return res.json({error: "Error creating room"});
            }

            room.date = dateFormat(room.created_at, "h:MM TT | mmm d");
            await room.save();

            const roomObject = {student: req.user._id, room: room._id}; //Add student to object and put it into tutor object
            tutor.tutor.newRoomCount.push(room._id);
            req.user.newRoomCount.push(room._id);
            await tutor.tutor.save();
            await req.user.save();

            tutor.rooms.push(roomObject);
            await course.save();

            const studentIds = await User.find({authenticated: true, _id: {$in: tutor.students}});
            if (!studentIds) {
                return res.json({error: "Error accessing students"});
            }

            return res.json({
                success: "Succesfully joined tutor",
                user: req.user,
                room: roomObject.room,
                tutor,
                formerStudent,
                students: studentIds
            });
        }
    }
}

module.exports.leaveTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor');
    if (!course) {
        return res.json({error: "Error leaving course"});
    }

    for (let tutor of course.tutors) { //If the selected tutor is the one being left, and the user is a student of that tutor, leave
        if (tutor.tutor._id.equals(req.body.tutorId)) {
            if (tutor.students.includes(req.user._id)) {
                tutor.students.splice(tutor.students.indexOf(req.user._id), 1);
                if (!tutor.formerStudents.includes(req.user._id)) {
                    tutor.formerStudents.push(req.user._id);
                }

                tutor.slots++;
                tutor.available = true;

                for (let i = 0; i < tutor.rooms.length; i++) { //Update rooms
                    if (tutor.rooms[i].student.equals(req.user._id)) {
                        const room = await Room.findByIdAndDelete(tutor.rooms[i].room);
                        if (!room) {
                            return res.json({error: "Error removing room"});
                        }

                        tutor.tutor.newRoomCount.splice(tutor.tutor.newRoomCount.indexOf(tutor.rooms[i].room));
                        req.user.newRoomCount.splice(tutor.tutor.newRoomCount.indexOf(tutor.rooms[i].room));
                        await tutor.tutor.save();
                        await req.user.save();
                        tutor.rooms.splice(i, 1);
                        break;
                    }
                }

                await course.save();
                return res.json({success: "Succesfully left tutor", user: req.user});

            } else {
                return res.json({error: "You are not a student of this tutor"});
            }
        }
    }
}

module.exports.upvoteTutor = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error upvoting tutor"});
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.body.tutorId)) { //Search for tutor until they are found
            if (tutor.students.includes(req.user._id) || tutor.formerStudents.includes(req.user._id)) { //Only current/former students of a tutor can upvote them
                if (tutor.upvotes.includes(req.user._id)) { //If tutor is currently upvoted by this user, downvote them
                    tutor.upvotes.splice(tutor.upvotes.indexOf(req.user._id), 1);
                    await course.save();
                    return res.json({success: "Downvoted tutor", upvoteCount: tutor.upvotes.length});
                }

                tutor.upvotes.push(req.user._id);
                await course.save();
                return res.json({success: "Upvoted tutor", upvoteCount: tutor.upvotes.length});
            }

            return res.json({error: "You are not a student of this tutor"});
        }
    }
}

module.exports.rateTutor = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        return res.json({error: "Error reviewing tutor"});
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.body.tutorId)) {
            if (tutor.students.includes(req.user._id) || tutor.formerStudents.includes(req.user._id)) { //Only current/former students of a tutor can upvote them
                let review = await PostComment.create({text: req.body.review, sender: req.user}); //Create comment with review
                if (!review) {
                    return res.json({error: "Error reviewing tutor"});
                }

                review.date = dateFormat(review.created_at, "h:MM TT | mmm d");
                await review.save();
                const reviewObject = {review, rating: req.body.rating};
                tutor.reviews.push(reviewObject);
                await course.save();

                let averageRating = 0;
                for (let review of tutor.reviews) {
                    averageRating += review.rating;
                }

                averageRating = Math.round(averageRating / tutor.reviews.length);
                return res.json({
                    success: "Succesfully upvoted tutor",
                    averageRating,
                    reviews_length: tutor.reviews.length,
                    review: reviewObject,
                    user: req.user
                });
            }

            return res.json({error: "You are not a student of this tutor"});
        }
    }
}

module.exports.likeReview = async function(req, res) {
    const review = await PostComment.findById(req.params.id);
    if (!review) {
        return res.json({error: "Error accessing review"});
    }

    if (review.likes.includes(req.user._id)) { //If user has liked this review, remove a like
        review.likes.splice(review.likes.indexOf(req.user._id), 1);
        await review.save();
        return res.json({success: "Removed a like", likeCount: review.likes.length, review});
    }

    review.likes.push(req.user._id);
    await review.save();
    return res.json({success: "Liked", likeCount: review.likes.length});
}

//----OTHER----//

module.exports.showTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate("tutors.tutor tutors.formerStudents").populate({
        path: "tutors.reviews.review",
        populate: {path: "sender"}
    });
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    let tutorIds = [];
    for (let tutor of course.tutors) {
        tutorIds.push(tutor.tutor._id.toString());
    }

    let courseStudents = [];
    for (let student of course.students) {
        courseStudents.push(student.toString());
    }

    for (let tutor of course.tutors) {
        if (tutor.tutor._id.equals(req.query.tutorId)) {
            let studentIds = []; //Collect info on all students who are members of this tutor
            for (let student of course.students) {
                studentIds.push(student.toString());
            }

            let enrolledCourses = []; //Collect all courses which this tutor teaches (that are not the current one)
            const courses = await Course.find({_id: {$ne: course._id}}).populate("teacher");
            if (!courses) {
                req.flash('error', "Unable to find courses");
                return res.redirect('back');
            }

            for (let course of courses) {
                for (let t of course.tutors) {
                    if (t.tutor.equals(tutor.tutor._id)) {
                        enrolledCourses.push(course);
                    }
                }
            }

            let averageRating = 0;
            for (let review of tutor.reviews) {
                averageRating += review.rating;
            }
            averageRating = Math.round(averageRating / tutor.reviews.length);

            const students = await User.find({authenticated: true, _id: {$in: tutor.students}});
            if (!students) {
                req.flash('error', "Unable to find students");
                return res.redirect('back');
            }

            let lessonMap = new Map();
            let lessons = [];
            let time = 0;
            for (let student of tutor.students.concat(tutor.formerStudents)) {
                lessons = [];
                time = 0;
                for (let lesson of tutor.lessons) {
                    if (lesson.student.equals(student._id)) {
                        lessons.push(lesson);
                        time += lesson.time;
                    }
                }
                lessonMap.set(student._id.toString(), [lessons, time]);
            }

            if (req.query.studentId) {
                const student = await User.findById(req.query.studentId);
                if (!student) {
                    req.flash('error', "Unable to find students");
                    return res.redirect('back');
                }

                if (student._id.equals(req.user._id) || tutor.tutor._id.equals(req.user._id) || course.teacher._id.equals(req.user._id)) {
                    return res.render('homework/lessons', {course, tutor, student, lessons: lessonMap.get(student._id.toString())[0].reverse(), time: lessonMap.get(student._id.toString())[1]});
                } else {
                    req.flash('error', "You do not have permission to view that student");
                    return res.redirect('back');
                }
            }

            return res.render('homework/tutor-show', {
                course,
                tutor,
                students,
                studentIds,
                averageRating,
                lessons: lessonMap,
                courses: enrolledCourses
            });
        }
    }
}
