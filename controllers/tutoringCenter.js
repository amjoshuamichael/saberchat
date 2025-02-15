//LIBARIES
const dateFormat = require('dateformat');
const {sendGridEmail} = require("../services/sendGrid");
const {sortByPopularity} = require("../utils/popularity");
const {objectArrIndex, parsePropertyArray, removeIfIncluded} = require("../utils/object-operations");
const {cloudUpload, cloudDelete} = require('../services/cloudinary');
const {autoCompress} = require("../utils/image-compress");
const setup = require("../utils/setup");

//SCHEMA
const Platform = require("../models/platform");
const User = require('../models/user');
const {InboxMessage} = require('../models/notification');
const {Course, ChatRoom} = require('../models/group');
const {Review} = require('../models/post');

const controller = {};

//Index page - display all user's courses
controller.index = async function(req, res) {
    const platform = await setup(Platform);
    const courses = await Course.find({}); //Load all courses
    if (!platform || !courses) {
        req.flash('error', "Unable to find courses");
        return res.redirect('back');
    }

    let courseList = [];
    for (let course of courses) { //Iterate through each course and see if user is a part of it (as teacher, student or tutor)
        if ((course.creator.equals(req.user._id)) || (course.members.includes(req.user._id)) || (objectArrIndex(course.tutors, "tutor", req.user._id) > -1)) {
            courseList.push(course);
        }
    }
    //Return compiled data
    return res.render('tutoringCenter/index', {platform, courses: courseList, studentStatuses: platform.studentStatuses, data: platform.features[objectArrIndex(platform.features, "route", "tutoringCenter")]});
}

//Create course as teacher
controller.createCourse = async function(req, res) {
    let charSetMatrix = []; //Build unique join code for course
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
        creator: req.user
    });

    if (!course) {
        req.flash('error', "Unable to create course");
        return res.redirect('back');
    }

    //If thumbnail file has been uploaded, set it up with cloudinary
    if (req.files) {
        if (req.files.mediaFile) {
            const file = req.files.mediaFile[0];
            const processedBuffer = await autoCompress(file.originalname, file.buffer);
            const [cloudErr, cloudResult] = await cloudUpload(file.originalname, processedBuffer);
            if (cloudErr || !cloudResult) {
                req.flash("error", "Upload failed");
                return res.redirect("back");
            }

            course.thumbnailFile = { //Set up thumbnail file through cloudinary result data
                filename: cloudResult.public_id,
                url: cloudResult.secure_url,
                originalName: file.originalname,
                display: req.body.showThumbnail == "upload"
            };
            await course.save();
        }
    }
    req.flash('success', "Successfully created course");
    return res.redirect('/tutoringCenter');
}

//Join as tutor or as student
controller.joinCourse = async function(req, res) {
    const platform = await setup(Platform);
    const course = await Course.findOne({joinCode: req.body.joincode}); //Search for course by join code
    if (!platform || !course) {
        req.flash('error', "No courses matching this join code were found.");
        return res.redirect('back');
    }

    //Join as tutor
    if (req.body.bio) {
        if (req.user.tags.includes("Tutor")) { //Ensure that user has permissions to become tutor
            course.tutors.push({ //Add user's data and form settings to tutor's list
                tutor: req.user,
                bio: req.body.bio,
                slots: parseInt(req.body.slots),
                cost: parseInt(req.body.cost),
                available: (parseInt(req.body.slots) > 0), //Check that user has available slots
                dateJoined: new Date(Date.now())
            });
            await course.save();
            req.flash('success', `Successfully joined ${course.name} as a tutor!`);
            return res.redirect(`/tutoringCenter/${course._id}`);
        }
        req.flash('error', `You do not have permission to do that`); //User does not have tutor perms
        return res.redirect(`back`);
    }

    //Join as student
    if (platform.studentStatuses.includes(req.user.status)) {
        course.members.push(req.user);
        await course.save();
        req.flash('success', `Successfully joined ${course.name}!`);
        return res.redirect(`/tutoringCenter/${course._id}`);
    }
    req.flash('error', `You do not have permission to do that`);
    return res.redirect(`back`);
}

//Show route - displays course interface for those with permissions
controller.showCourse = async function(req, res) {
    const platform = await setup(Platform);
    //Load course with populated data
    const course = await Course.findById(req.params.id).populate('creator members tutors.tutor tutors.reviews blocked');
    if (!platform || !course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    //Collect info on the ids of all members and tutors in the course
    let studentIds = [];
    let tutorIds = [];
    let tutors = [];
    for (let student of course.members) {
        studentIds.push(student._id.toString());
    }

    let averageRating = 0; //Collect info on tutors and their ratings
    let tutorObject = {};
    for (let tutor of course.tutors) {
        averageRating = 0;
        tutorObject = {};
        tutorIds.push(tutor.tutor._id.toString());
        for (let review of tutor.reviews) {
            averageRating += review.rating;
        }
        averageRating = (Math.round(averageRating / tutor.reviews.length));
        tutorObject = tutor;
        tutorObject.averageRating = averageRating;
        tutors.push(tutorObject)
    }

    //Sort tutors for display by two characteristics - average rating and reviews
    tutors = sortByPopularity(tutors, "averageRating", "dateJoined", null).unpopular
    .concat(sortByPopularity(tutors, "averageRating", "dateJoined", null).popular);

    tutors = sortByPopularity(tutors, "reviews", "dateJoined", null).unpopular
    .concat(sortByPopularity(tutors, "reviews", "dateJoined", null).popular);

    const teachers = await User.find({authenticated: true, status: platform.teacherStatus, _id: {$ne: req.user._id}});
    if (!teachers) {
        req.flash('error', "Unable to find teachers");
        return res.redirect('back');
    }
    return res.render('tutoringCenter/show', {platform, course, studentIds, tutorIds, tutors, teachers, objectArrIndex, data: platform.features[objectArrIndex(platform.features, "route", "tutoringCenter")]}); //Export function for ejs evaluation
}

//Unenroll from course (as a student)
controller.unenrollStudent = async function(req, res) {
    const course = await Course.findByIdAndUpdate(req.params.id, {$pull: {members: req.user._id}}).populate("tutors.tutor");
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    //Remove user from all tutors they have signed up with, and delete corresponding chat rooms
    let deletedRoom;
    for (let tutor of course.tutors) {
        if (objectArrIndex(tutor.members, "student", req.user._id) > -1) { //Update the tutor's members array
            tutor.formerStudents.push({
                student: req.user._id,
                lessons: tutor.members[objectArrIndex(tutor.members, "student", req.user._id)].lessons
            });
            //Access room and officially remove from DB
            deletedRoom = await ChatRoom.findByIdAndDelete(tutor.members[objectArrIndex(tutor.members, "student", req.user._id)].room);
            tutor.members.splice(objectArrIndex(tutor.members, "student", req.user._id), 1);
            tutor.slots++;
            tutor.available = true;

            //Remove rooms from tutor/student newRooms
            removeIfIncluded(req.user.newRooms, deletedRoom._id);
            await req.user.save();
            removeIfIncluded(tutor.tutor.newRooms, deletedRoom._id);
            await tutor.tutor.save();
        }
    }
    await course.save();
    req.flash('success', `Unenrolled from ${course.name}!`);
    return res.redirect('/tutoringCenter');
}

//Unenroll from course (as a tutor)
controller.unenrollTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.members.student');
    if (!course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    for (let i = course.tutors.length - 1; i >= 0; i--) {
        if (course.tutors[i].tutor._id.equals(req.user._id)) { //If the selected tutor is the current user
            let deletedRoom;
            for (let student of course.tutors[i].members) { //Remove all chat rooms between tutor and student
                deletedRoom = await ChatRoom.findByIdAndDelete(student.room);
                if (!deletedRoom) {
                    req.flash('error', "Unable to remove chat room");
                    return res.redirect('back');
                }

                //Remove rooms from tutor/student newRooms
                removeIfIncluded(student.student.newRooms, deletedRoom._id);
                await student.student.save();
                removeIfIncluded(req.user.newRooms, deletedRoom._id);
                await req.user.save();
            }
            course.tutors.splice(i, 1); //Remove tutor from course
            break;
        }
    }
    await course.save();
    req.flash('success', `Unenrolled from ${course.name}!`);
    return res.redirect('/tutoringCenter');
}

//Update course settings
controller.updateSettings = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        req.flash("error", "An error occurred");
        return res.redirect("back");
    }

    for (let attr in req.body) { //Iterate through each of the data's keys and update the course with the corresponding value
        if (attr != "thumbnail" && (req.body[attr].split(' ').join('') != '')) {course[attr] = req.body[attr];}
    }

    if (req.body.thumbnail.split(' ').join('') != '') {course.thumbnail = {url: req.body.thumbnail, display: req.body.showThumbnail == "url"};}
    course.thumbnailFile.display = req.body.showThumbnail == "upload";

    //Iterate through newly uploaded thumbnail file, handle with cloudinary
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

        if (req.files.mediaFile) { //Check if a new media file has been passed through form
            const file = req.files.mediaFile[0];
            //Compress and upload file to cloudinary
            const processedBuffer = await autoCompress(file.originalname, file.buffer);
            [cloudErr, cloudResult] = await cloudUpload(file.originalname, processedBuffer);
            if (cloudErr || !cloudResult) {
                req.flash("error", "Upload failed");
                return res.redirect("back");
            }

            course.thumbnailFile = { //Update thumbnail display
                filename: cloudResult.public_id,
                url: cloudResult.secure_url,
                originalName: file.originalname,
                display: req.body.showThumbnail == "upload"
            };
        }
    }

    await course.save();
    req.flash("success", "Updated course settings")
    return res.redirect(`/tutoringCenter/${course._id}`);
}

//Delete Course
controller.deleteCourse = async function(req, res) {
    //Access course data and populate all necessary accessible data
    const course = await Course.findOne({_id: req.params.id, joinCode: req.body.joincode}).populate("tutors.tutor tutors.members.student");
    if (!course) {
        req.flash("error", "Incorrect join code");
        return res.redirect("back");
    }

    let deletedRoom;
    for (let tutor of course.tutors) { //Iterate through tutors and delete all of their rooms
        for (let student of tutor.members) {
            deletedRoom = await ChatRoom.findByIdAndDelete(student.room);
            if (!deletedRoom) {
                req.flash("error", "Unable to find room");
                return res.redirect("back");
            }
            //Remove room from student and teacher's "newRooms" data field
            removeIfIncluded(tutor.tutor.newRooms, student.room);
            await tutor.tutor.save();
            removeIfIncluded(student.student.newRooms, student.room);
            await student.student.save();
        }
    }

    const deletedCourse = await Course.findByIdAndDelete(course._id); //Officially delete course
    if (!deletedCourse) {
        req.flash("error", "An error occurred");
        return res.redirect("back");
    }
    req.flash("success", `Deleted ${course.name}!`);
    return res.redirect("/tutoringCenter");
}

//-----------TEACHER ROUTES -----------//

//Update course teacher
controller.updateTeacher = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {
        req.flash("error", "Unable to find course");
        return res.redirect("back");
    }

    //Double-security check - confirmed join code matches course join
    if (!(course.joinCode == req.body.joinCodeConfirm)) {
        req.flash("error", "Join code is invalid");
        return res.redirect("back");
    }

    const newTeacher = await User.findById(req.body.teacher); //Access new teacher's user profile
    if (!newTeacher) {
        req.flash("error", "Error finding teacher");
        return res.redirect("back");
    }

    course.creator = newTeacher; //Set new teacher and save data updates
    await course.save();
    req.flash("success", "Updated course teacher!");
    return res.redirect("/tutoringCenter");
}

//Update course's join code
controller.updateJoinCode = async function(req, res) {
    let charSetMatrix = [ //Build new join code through three character paths
        'qwertyuiopasdfghjklzxcvbnm'.split(''),
        'QWERTYUIOPASDFGHJKLZXCVBNM'.split(''),
        '1234567890'.split('')
    ];

    let code_length = Math.round((Math.random() * 15)) + 10; //Select random length between 10-25
    let joinCode = "";

    let charSet; //Iterate through character paths and choose random character for each string index
    for (let i = 0; i < code_length; i++) {
        charSet = charSetMatrix[Math.floor(Math.random() * 3)];
        joinCode += charSet[Math.floor((Math.random() * charSet.length))];
    }

    const course = await Course.findById(req.params.id); //Access course and update join code
    if (!course) {return res.json({error: "An Error Occurred"});}
    course.joinCode = joinCode;
    await course.save();
    return res.json({success: "Succesfully Updated Join Code", joinCode});
}

//Course tutor search
controller.searchTutors = async function(req, res) {
    //Initialize platform and specific course
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {return res.json({error: "An error occurred"});}

    //Collect user data based on form
    const users = await User.find({authenticated: true, _id: {$ne: req.user._id}, status: {$in: platform.studentStatuses}});
    if (!users) {return res.json({error: "An error occurred"});}

    let tutors = [];
    let displayValue;

    for (let status of platform.studentStatuses) { //Iterate through statuses and search for matches
        displayValue = platform.statusesPlural[platform.statusesProperty.indexOf(status)];
        if (`${status} ${displayValue}`.toLowerCase().includes(req.body.text.toLowerCase())) {
            tutors.push({ //Add status to array, using display and id values
                displayValue,
                idValue: status,
                type: "status"
            });
        }
    }

    for (let user of users) { //Iterate through usernames and search for matches
        //Check that user is not currently tutoring this course, is a verified tutor and is part of search
        if (objectArrIndex(course.tutors, "tutor", user._id) == -1 && user.tags.includes("Tutor") && `${user.firstName} ${user.lastName} ${user.username}`.toLowerCase().includes(req.body.text.toLowerCase())) {
            tutors.push({ //Add user to array, using username as display, and id as id value
                displayValue: `${user.firstName} ${user.lastName} (${user.username})`, 
                idValue: user._id,
                classValue: user.status,
                type: "user"
            });
        }
    }
    return res.json({success: "Successfully collected data", tutors}); //Send data to frontend
}

controller.assignTutor = async function(req, res) { //Assign user to tutor a course's student (as a teacher)
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id).populate("tutors.tutor"); //Populate tutor data
    const student = await User.findById(req.query.student); //Populate student data
    if (!platform || !course || !student) {
        req.flash("error", "An error occurred");
        return res.redirect("back");
    }

    for (let tutor of course.tutors) { //Iterate through course tutors and check that student does not have any other current tutors
        if (tutor.members.includes(student._id)) {
            req.flash("error", "Student is already enrolled with another tutor");
            return res.redirect("back");
        }
    }

    let selectedTutor;
    for (let tutor of course.tutors) { //Iterate through course tutors and add student to correct tutor
        if (tutor.tutor._id.equals(req.body.assignTutor)) {
            selectedTutor = tutor;
            break;
        }
    }

    const room = await ChatRoom.create({ //Create chat room between student and tutor
        name: `${student.firstName}'s Tutoring Sessions With ${selectedTutor.tutor.firstName} - ${course.name}`,
        creator: selectedTutor.tutor._id,
        members: [student._id, selectedTutor.tutor._id],
        private: true,
        mutable: false
    });
    if (!room) {
        req.flash("error", "An error occurred");
        return res.redirect("back");
    }
    
    //Add student to tutor's member list
    selectedTutor.members.push({student, room, lessons: []});
    await course.save();
    
    //Update newRooms for both student and tutor
    selectedTutor.tutor.newRooms.push(room._id);
    student.newRooms.push(room._id);
    await selectedTutor.tutor.save();
    await student.save();

    //Notify tutor and student of new signup
    await sendGridEmail(selectedTutor.tutor.email, `New student in ${course.name}`, `<p>Hello ${selectedTutor.tutor.firstName},</p><p>${student.username} has been signed up as your student in ${course.name}.</p>`, false);
    await sendGridEmail(student.email, `Tutor signup in ${course.name}`, `<p>Hello ${student.firstName},</p><p>${selectedTutor.tutor.username} has been signed up as your tutor in ${course.name}.</p>`, false);

    req.flash("success", `${selectedTutor.tutor.firstName} ${selectedTutor.tutor.lastName} is now tutoring ${student.firstName} ${student.lastName}!`);
    return res.redirect(`/tutoringCenter/${course._id}`);
}

//Course student search
controller.searchStudents = async function(req, res) {
    //Initialize platform and specific course
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {return res.json({error: "An error occurred"});}

    //Collect user data based on form
    const users = await User.find({authenticated: true, _id: {$ne: req.user._id}, status: {$in: platform.studentStatuses}});
    if (!users) {return res.json({error: "An error occurred"});}

    let students = [];
    let displayValue;

    for (let status of platform.studentStatuses) { //Iterate through statuses and search for matches
        displayValue = platform.statusesPlural[platform.statusesProperty.indexOf(status)];
        if (`${status} ${displayValue}`.toLowerCase().includes(req.body.text.toLowerCase())) {
            students.push({ //Add status to array, using display and id values
                displayValue,
                idValue: status,
                type: "status"
            });
        }
    }

    for (let user of users) { //Iterate through usernames and search for matches
        //Check that user is not currently a student in this course
        if (!course.members.includes(user._id) && `${user.firstName} ${user.lastName} ${user.username}`.toLowerCase().includes(req.body.text.toLowerCase())) {
            students.push({ //Add user to array, using username as display, and id as id value
                displayValue: `${user.firstName} ${user.lastName} (${user.username})`, 
                idValue: user._id,
                classValue: user.status,
                type: "user"
            });
        }
    }
    return res.json({success: "Successfully collected data", students}); //Send data to frontend
}

//Add tutors to course, as a faculty member
controller.updateTutors = async function(req, res) {
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {
        req.flash("An error occurred");
        return res.redirect("back");
    }

    if (req.body.tutorInput != '') {
        for (let user of req.body.tutorInput.split(',')) {
            if (platform.studentStatuses.includes(user)) { //Added 'tutor' is a full status of users
                for (let u of await User.find({status: user})) {
                    if (!(course.members.includes(u._id)) && (objectArrIndex(course.tutors, "tutor", u._id) == -1)) {
                        course.tutors.push({
                            tutor: u._id,
                            bio: '',
                            slots: 0,
                            cost: 10,
                            available: 0,
                            dateJoined: new Date(Date.now())
                        });
                    }
                }

            //Added student is a user ID
            } else if (!(course.members.includes(user)) && (objectArrIndex(course.tutors, "tutor", user) == -1)) {
                course.tutors.push({
                    tutor: User.findById(user),
                    bio: '',
                    slots: 0,
                    cost: 10,
                    available: 0,
                    dateJoined: new Date(Date.now())
                });
            }
        }
        await course.save();
        req.flash("success", "Successfully added tutors!");
    }
    return res.redirect(`/tutoringCenter/${req.params.id}`);
}

//Add students to a course, as a faculty member
controller.updateStudents = async function(req, res) {
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {
        req.flash("An error occurred");
        return res.redirect("back");
    }

    if (req.body.studentInput != '') {
        for (let user of req.body.studentInput.split(',')) {
            if (platform.studentStatuses.includes(user)) { //Added 'student' is a full status of usrs
                for (let u of await User.find({status: user})) {
                     //Check that each user is not a current tutor for this course
                    if (!(course.members.includes(u._id)) && (objectArrIndex(course.tutors, "tutor", u._id)) == -1) {
                        course.members.push(u);
                    }
                };
            } else { //Added student represents user ID
                //Check that user is not a current tutor for this course
                if (!(course.members.includes(user)) && (objectArrIndex(course.tutors, "tutor", user) == -1)) {
                    course.members.push(User.findById(user));
                }
            }
        }
        await course.save();
        req.flash("success", "Successfully added students!");
    }
    return res.redirect(`/tutoringCenter/${req.params.id}`);
}

//Remove student from course
controller.removeStudent = async function(req, res) {
    const studentId = await User.findById(req.body.studentId);
    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.members.student');
    if (!studentId || !course) {return res.json({error: "Error removing student"});}

    let deletedRoom;
    for (let tutor of course.tutors) { //Iterate through tutors and remove the student
        if (objectArrIndex(tutor.members, "student", studentId._id, "_id") > -1) {
            tutor.formerStudents.push({ //Add student to list of former studnts
                student: studentId._id,
                lessons: tutor.members[objectArrIndex(tutor.members, "student", studentId._id, "_id")].lessons
            });
            deletedRoom = await ChatRoom.findByIdAndDelete(tutor.members[objectArrIndex(tutor.members, "student", studentId._id, "_id")].room);
            if (!deletedRoom) {return res.json({error: "Error removing room"});}

            //Update newRooms for student and tutor, and remove student from list of tutor's current members
            removeIfIncluded(studentId.newRooms, deletedRoom._id);
            await studentId.save();
            removeIfIncluded(tutor.tutor.newRooms, deletedRoom._id);
            await tutor.tutor.save();
            tutor.members.splice(objectArrIndex(tutor.members, "student", studentId._id, "_id"), 1);
        }
    }

    const notif = await InboxMessage.create({  //Create a notification to alert the student that they have been blocked
        subject: `Removal from ${course.name}`,
        text: `You were removed from ${course.name} for the following reason:\n"${req.body.reason}"`,
        author: req.user,
        noReply: true,
        recipients: [studentId._id],
        read: [],
        images: []
    });
    if (!notif) {return res.json({error: "Error removing student"});}

    notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
    await notif.save()
    studentId.inbox.push({message: notif, new: true});
    await studentId.save();
    if (studentId.receiving_emails) {
        await sendGridEmail(studentId.email, `Removal from ${course.name}`, `<p>Hello ${studentId.firstName},</p><p>${notif.text}</p>`, false);
    }
    // course.blocked.push(studentId);
    removeIfIncluded(course.members, studentId._id); //Remove student from course officially
    await course.save();
    return res.json({success: "Succesfully removed student", student: studentId, course});
}

//Remove tutor from course
controller.removeTutor = async function(req, res) {
    let tutorId;
    if (req.body.show) {
        tutorId = await User.findById(req.body.tutorId);
        if (!tutorId) {return res.json({error: "Error removing tutor"});}
    } else {
        tutorId = await User.findById(req.query.tutorId);
        if (!tutorId) {
            req.flash("error", "Error removing tutor");
            return res.redirect("back");
        }
    }

    //Access course
    const course = await Course.findById(req.params.id).populate('tutors.tutor tutors.members.student');
    if (!course) { //Depending on which interface, send JSON response or reload screen
        if (req.body.show) {return res.json({error: "Error removing tutor"});
        } else {
            req.flash("error", "Error removing tutor");
            return res.redirect("back");
        }
    }

    for (let i = 0; i < course.tutors.length; i++) { //Iterate through course tutors
        if (course.tutors[i].tutor._id.equals(tutorId._id)) {
            let deletedRoom;
            //For all of the tutor's rooms, remove room and update members' new room counts
            for (let student of course.tutors[i].members) {
                deletedRoom = await ChatRoom.findByIdAndDelete(student.room);
                if (!deletedRoom) {
                    if (req.body.show) {return res.json({error: "Error removing tutor"});
                    } else {
                        req.flash("error", "Error removing tutor");
                        return res.redirect("back");
                    }
                }
                removeIfIncluded(student.student.newRooms, deletedRoom._id);
                await student.student.save();
                removeIfIncluded(tutorId.newRooms, deletedRoom._id);
                await tutorId.save();
            }

            const notif = await InboxMessage.create({ //Create a notification to alert tutor that they have been removed
                subject: `Removal from ${course.name}`,
                text: `You were removed from ${course.name} for the following reason:\n"${req.body.reason}"`,
                author: req.user,
                noReply: true,
                recipients: [tutorId._id],
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

            tutorId.inbox.push({message: notif, new: true}); //Save message and add to tutor's inbox
            await tutorId.save();
            if (tutorId.receiving_emails) {
                await sendGridEmail(tutorId.email, `Removal from ${course.name}`, `<p>Hello ${tutorId.firstName},</p><p>${notif.text}</p>`, false);
            }

            // course.blocked.push(tutorId); //Remove tutor and block them
            course.tutors.splice(i, 1);
            await course.save();

            //Depending on interface, either send JSON response or reload page
            if (req.body.show) {return res.json({success: "Succesfully removed tutor", tutor: tutorId, course})};
            req.flash("success", "Succesfully Removed Tutor!");
            return res.redirect(`/tutoringCenter/${course._id}`);
        }
    }
}

controller.unblock = async function(req, res) { //Unblock a previously blocked user
    const blockedId = await User.findById(req.body.blockedId);
    const course = await Course.findById(req.params.id);

    if (!blockedId || !course) {return res.json({error: "Unable to access course"});}
    if (!course.blocked.includes(blockedId._id)) {return res.json({error: "User is not blocked from this course"});} //If the user is not blocked, they cannot be unblocked
    
    removeIfIncluded(course.blocked, blockedId._id); //Unblock user
    await course.save();
    const notif = await InboxMessage.create({  //Create a notification to alert the user
        subject: `Unblocked from ${course.name}`,
        text: `You have been unblocked from ${course.name}. You can rejoin with the join code now whenever you need to.`,
        author: req.user,
        noReply: true,
        recipients: [blockedId._id],
        read: [],
        images: []
    });
    if (!notif) {return res.json({error: "Error removing student"});}

    notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
    await notif.save();

    //Send message notifying user that they have been unblocked
    blockedId.inbox.push({message: notif, new: true});
    await blockedId.save();
    if (blockedId.receiving_emails) {
        await sendGridEmail(blockedId.email, `Removal from ${course.name}`, `<p>Hello ${blockedId.firstName},</p><p>${notif.text}</p>`, false);
    }
    return res.json({success: "Succesfully unblocked user", blocked: blockedId, course});
}

//-----------TUTOR ROUTES -----------//

//Mark tutoring lesson payment
controller.markPayment = async function(req, res) {
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {return res.json({error: "Unable to find course"});}

    for (let tutor of course.tutors) { //Iterate through course tutors and search for current tutor
        if (tutor.tutor.equals(req.user._id)) {
            for (let student of tutor.members) { //Iterate through students and access current student
                if (student.student.equals(req.body.studentId)) {
                    if (student.lessons[req.body.index]) { //Check if the current lesson is a valid index
                        //Switch payment truth value
                        student.lessons[req.body.index].paid = !student.lessons[req.body.index].paid;
                        await course.save();

                        //Calculate new cost
                        let cost = 0;
                        let time = 0;
                        let costString;
                        for (let lesson of student.lessons) {
                            if (lesson.approved) {time += lesson.time;
                                if (!lesson.paid) {cost += (lesson.time/60)*tutor.cost;}
                            }
                        }
                        //Modify cost value based on whether platform works with currency or credits
                        if (platform.purchasable) {costString = (cost.toFixed(2));
                        } else {costString = cost;}
                        //Send updated data as response to frontend
                        return res.json({success: "Successfully changed", time, cost: costString});
                    }
                }
            }
            return res.json({error: "Student not found"});
        }
    }
    return res.json({error: "Tutor not found"});
}

//Update bio as tutor
controller.updateBio = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Unable to find course"});}

    for (let tutor of course.tutors) { //Iterate through tutors and search for current user
        if (tutor.tutor.equals(req.user._id)) {
            tutor.bio = req.body.bio; //Update bio with form data
            await course.save();
            return res.json({success: "Successfully changed"})
        }
    }
}

//Shut down lessons and close availability
controller.closeLessons = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error closing lessons"});}

    for (let tutor of course.tutors) {
        //If the selected tutor matches the current user, shut down availability
        if (tutor.tutor.equals(req.user._id)) {
            tutor.available = false;
            await course.save();
            return res.json({success: "Successfully closed lessons"});
        }
    }
}

//Restart lessons and reopen availability
controller.reopenLessons = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error closing lessons"});}

    for (let tutor of course.tutors) {
        //If the selected tutor matches the current user, reopen availability
        if (tutor.tutor.equals(req.user._id)) {
            tutor.available = true;
            await course.save();
            return res.json({success: "Successfully closed lessons"});
        }
    }
}

//Set total number of allowed student slots
controller.setStudents = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error accessing course"});}

    for (let tutor of course.tutors) { //Search through tutors to find requested tutor
        if (tutor.tutor.equals(req.user._id)) {
            tutor.slots = parseInt(req.body.slots) - tutor.members.length; //Update slots based on data
            if ((parseInt(req.body.slots) - tutor.members.length) == 0) {
                tutor.available = false; //Update availability based on new slot info (if there are 0, set to unavailable)
            }
            await course.save();
            return res.json({success: "Succesfully changed", tutor});
        }
    }
    return res.json({error: "Unable to find tutor"});
}

//Set hourly cost
controller.setCost = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error accessing course"});}

    for (let tutor of course.tutors) { //Search through tutors to find requested tutor
        if (tutor.tutor.equals(req.user._id)) {
            tutor.cost = parseInt(req.body.cost); //Update hourly cost based on form data
            await course.save();
            return res.json({success: "Succesfully changed", tutor}); //Send result to frontend
        }
    }
    return res.json({error: "Unable to find tutor"});
}

//Mark a lesson between student and tutor
controller.markLesson = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error accessing course"});}

    const newLesson = { //Create lesson object with total time (in minutes), date, and summary (text)
        time: parseInt(req.body.time),
        date: dateFormat(new Date(), "mmm d"),
        summary: req.body.summary
    };

    //Find specific tutor and add lesson for their student
    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.user._id)) {
            let lessons = student.lessons.slice(); //Copy over student lessons
            for (let student of tutor.members) { //Iterate through students and add lesson to matching user
                if (student.student.equals(req.body.studentId)) {
                    student.lessons.push(newLesson);
                    lessons.push(newLesson);
                    await course.save();
                    return res.json({success: "Succesfully updated", tutor, lessons});
                }
            }
        }
    }
}

//-----------STUDENT ROUTES -----------//

//Book tutor for lessns
controller.bookTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor');
    if (!course) {
        req.flash("error", "Unable to find course");
        return res.redirect("back");
    }

    let formerStudent = false;
    let lessons = [];
    for (let tutor of course.tutors) { //Iterate through tutors and search for the corresponding one
        if (objectArrIndex(tutor.members, "student", req.user._id) > -1) {
            req.flash("error", "You are already have a tutor"); //Don't allow student to sign up if they already have a tutor
            return res.redirect("back");
        }

        //Iterate through tutors and find matching result
        if (tutor.tutor._id.equals(req.query.tutorId) && tutor.available) {
            if (objectArrIndex(tutor.formerStudents, "student", req.user._id) > -1) { //Remove student from tutor's former members (if they were there)
                formerStudent = true; //Keep tracker to send to frontend
                lessons = objectArrIndex(tutor.formerStudents, "student", req.user._id).lessons;
                tutor.formerStudents.splice(objectArrIndex(tutor.formerStudents, "student", req.user._id), 1);
            }

            //Decrement tutor slots; if user slots are now 0, set to unavailable
            tutor.slots--;
            tutor.available = (tutor.slots != 0);

            const room = await ChatRoom.create({ //Create chat room between student and tutor
                name: `${req.user.firstName}'s Tutoring Sessions With ${tutor.tutor.firstName} - ${course.name}`,
                creator: tutor.tutor._id,
                members: [req.user._id, tutor.tutor._id],
                private: true,
                mutable: false
            });
            if (!room) {
                req.flash("error", "Unable to create chat room;");
                return res.redirect("back");
            }

            //Add room to student and tutor's newRoom list
            room.date = dateFormat(room.created_at, "h:MM TT | mmm d");
            await room.save();
            tutor.tutor.newRooms.push(room._id);
            req.user.newRooms.push(room._id);
            await tutor.tutor.save();
            await req.user.save();

            //Create student object with empty lessons array, and add to tutor's member list
            const studentObject = {
                student: req.user._id, lessons,
                room: room._id
            }
            tutor.members.push(studentObject);
            await course.save();

            if (tutor.tutor.receiving_emails) {
                await sendGridEmail(tutor.tutor.email, `New student in ${course.name}`, `<p>Hello ${tutor.tutor.firstName},</p><p>${req.user.username} has signed up as your student in ${course.name}.</p>`, false);
            }

            //All current members of the tutor
            const studentIds = await User.find({authenticated: true, _id: {$in: parsePropertyArray(tutor.members, "student")}});
            if (!studentIds) {
                req.flash("error", "Error accessing students");
                return res.redirect("back");
            }

            //All former members of the tutor
            const formerStudents = await User.find({authenticated: true, _id: {$in: parsePropertyArray(tutor.formerStudents, "student")}});
            if (!formerStudents) {
                req.flash("error", "Error accessing students");
                return res.redirect("back");
            }

            req.flash("success", `Congratulations, ${req.user.firstName}. You have signed up with ${tutor.tutor.firstName} ${tutor.tutor.lastName} for tutoring!`);
            return res.redirect(`/chat/${room._id}`);
        }
    }
}

//Unenroll from lessons with a given tutor
controller.leaveTutor = async function(req, res) {
    const course = await Course.findById(req.params.id).populate('tutors.tutor');
    if (!course) {return res.json({error: "Error accessing course"});}

    let deletedRoom;
    for (let tutor of course.tutors) { //If the selected tutor is the one being left, and the user is a student of that tutor, leave
        if (tutor.tutor._id.equals(req.body.tutorId)) {
            if (objectArrIndex(tutor.members, "student", req.user._id) > -1) {
                deletedRoom = await ChatRoom.findByIdAndDelete(tutor.members[objectArrIndex(tutor.members, "student", req.user._id)].room);
                if (!deletedRoom) {return res.json({error: "Error deleting room"});}

                //Remove room, add student to tutor's former members
                removeIfIncluded(tutor.tutor.newRooms, tutor.members[objectArrIndex(tutor.members, "student", req.user._id)].room);
                await tutor.tutor.save();
                removeIfIncluded(req.user.newRooms, tutor.members[objectArrIndex(tutor.members, "student", req.user._id)].room)
                await req.user.save();
                if (objectArrIndex(tutor.formerStudents, "student", req.user._id) == -1) {
                    tutor.formerStudents.push({
                        student: req.user._id,
                        lessons: tutor.members[objectArrIndex(tutor.members, "student", req.user._id).lessons]
                    });
                }
                
                //Remove student from tutor list, and add a slot back
                tutor.members.splice(objectArrIndex(tutor.members, "student", req.user._id), 1);
                tutor.slots++;
                tutor.available = true;

                await course.save();
                return res.json({success: "Succesfully left tutor", user: req.user});
            }
            return res.json({error: "You are not a student of this tutor"});
        }
    }
}

//Upvote tutor (student has to have taken lessons with them already)
controller.upvoteTutor = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error upvoting tutor"});}

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.body.tutorId)) { //Search for tutor until they are found
            //Only current/former members of a tutor can upvote them
            if (objectArrIndex(tutor.members.concat(tutor.formerStudents), "student", req.user._id) > -1) {
                if (removeIfIncluded(tutor.upvotes, req.user._id)) { //If tutor is currently upvoted by this user, downvote them
                    await course.save();
                    return res.json({success: "Downvoted tutor", upvoteCount: tutor.upvotes.length});
                }
                //Add upvote to tutor's profile
                tutor.upvotes.push(req.user._id);
                await course.save();
                return res.json({success: "Upvoted tutor", upvoteCount: tutor.upvotes.length});
            }
            return res.json({error: "You are not a student of this tutor"});
        }
    }
}

//Submit a rating for tutor
controller.rateTutor = async function(req, res) {
    const course = await Course.findById(req.params.id);
    if (!course) {return res.json({error: "Error reviewing tutor"});}

    for (let tutor of course.tutors) {
        if (tutor.tutor.equals(req.body.tutorId)) {
            //Only current/former members of a tutor can upvote them
            if (objectArrIndex(tutor.members.concat(tutor.formerStudents), "student", req.user._id) > -1) {
                
                //Create Postcomment child with review
                const review = await Review.create({text: req.body.text.split('<').join('&lt'), sender: req.user, rating: req.body.rating});
                if (!review) {return res.json({error: "Error reviewing tutor"});}

                //Set date and add review to tutor's data
                review.date = dateFormat(review.created_at, "h:MM TT | mmm d");
                await review.save();
                tutor.reviews.push(review);
                await course.save();

                let averageRating = 0; //Sum up average rating and return (to be displayed on tutor's overall profile)
                for (let review of tutor.reviews) {averageRating += review.rating;}

                //Update tutor's average rating based on new rating
                averageRating = Math.round(averageRating / tutor.reviews.length);
                return res.json({
                    success: "Succesfully upvoted tutor",
                    averageRating, review,
                    reviews_length: tutor.reviews.length,
                    user: req.user
                });
            }
            return res.json({error: "You are not a student of this tutor"});
        }
    }
}

//Like a review (of a tutor that the student has worked with)
controller.likeReview = async function(req, res) {
    const review = await Review.findById(req.params.id);
    if (!review) {return res.json({error: "Error accessing review"});}

    if (removeIfIncluded(review.likes, req.user._id)) { //If user has liked this review, remove a like
        await review.save();
        return res.json({success: "Removed a like", likeCount: review.likes.length, review});
    }
    
    //Add like to review, save and send to frontend
    review.likes.push(req.user._id);
    await review.save();
    return res.json({success: "Liked", likeCount: review.likes.length});
}

//Approve lesson (as student)
controller.approveLesson = async function(req, res) {
    const platform = await setup(Platform);
    const course = await Course.findById(req.params.id);
    if (!platform || !course) {return res.json({error: "Unable to find course"});}
    for (let tutor of course.tutors) {

        //Iterate through tutors until correct user has been found
        if (tutor.tutor.equals(req.body.tutorId)) {
            for (let student of tutor.members) {
                
                //Iterate through tutor's students until correct user has been found                
                if (student.student.equals(req.user._id)) {
                    if (student.lessons[req.body.index]) {
                        //Mark lesson as approved
                        student.lessons[req.body.index].approved = !student.lessons[req.body.index].approved;
                        await course.save();

                        //Sum up total time and net cost
                        let cost = 0;
                        let time = 0;
                        let costString;
                        for (let lesson of student.lessons) {
                            if (lesson.approved) {
                                time += lesson.time;
                                if (!lesson.paid) {cost += (lesson.time/60)*tutor.cost;}
                            }
                        }
                        //Change cost display based on whether platform uses currency or credits
                        if (platform.dollarPayment) {costString = cost.toFixed(2);
                        } else {costString = cost;}
                        return res.json({success: "Successfully changed", time, cost: costString});
                    }
                }
            }
            return res.json({error: "Student not found"});
        }
    }
    return res.json({error: "Tutor not found"});
}

//----OTHER----//

//Display Tutor Profile
controller.showTutor = async function(req, res) {
    const platform = await setup(Platform);
    
    //Load course data and populate fields to be displayed
    const course = await Course.findById(req.params.id).populate("tutors.tutor tutors.members.student tutors.formerStudents.student").populate({
        path: "tutors.reviews",
        populate: {path: "sender"}
    });
    if (!platform || !course) {
        req.flash('error', "Unable to find course");
        return res.redirect('back');
    }

    //Collect all tutor and student IDs
    let tutorIds = [];
    for (let tutor of course.tutors) {tutorIds.push(tutor.tutor._id.toString());}
    let courseStudents = [];
    for (let student of course.members) {courseStudents.push(student.toString());}

    for (let tutor of course.tutors) {
        if (tutor.tutor._id.equals(req.query.tutorId)) {
            let studentIds = []; //Collect info on all course members 
            for (let student of course.members) {studentIds.push(student.toString());}

            let enrolledCourses = []; //Collect all courses which this tutor teaches (that are not the current one)
            const courses = await Course.find({_id: {$ne: course._id}}).populate("creator");
            if (!courses) {
                req.flash('error', "Unable to find courses");
                return res.redirect('back');
            }

            //Iterate through each course and check if tutor is enrolled as a tutor there
            for (let c of courses) {
                for (let t of c.tutors) {
                    if (t.tutor.equals(tutor.tutor._id)) {enrolledCourses.push(c);}
                }
            }

            let averageRating = 0; //Calculate tutor's average rating
            for (let review of tutor.reviews) {averageRating += review.rating;}
            averageRating = Math.round(averageRating / tutor.reviews.length);
            
            //Collect info on all members who are members of this tutor
            const members = await User.find({authenticated: true, _id: {$in: parsePropertyArray(tutor.members, "student")}});
            if (!members) {
                req.flash('error', "Unable to find members");
                return res.redirect('back');
            }

            let lessonMap = new Map(); //Track all lessons of this tutor's members
            let time = 0;
            let costMap = new Map();
            let cost = 0;
            for (let student of (tutor.members.concat(tutor.formerStudents))) {
                time = 0;
                cost = 0;
                for (let lesson of student.lessons) {
                    if (lesson.approved) {
                        time += lesson.time;
                        if (!lesson.paid) {cost += (lesson.time/60)*tutor.cost;}
                    }
                }
                lessonMap.set((student.student._id.toString()), time);
                if (platform.dollarPayment) {costMap.set((student.student._id.toString()), (cost.toFixed(2)));
                } else {costMap.set((student.student._id.toString()), cost);}
            }

            if (req.query.studentId) { //If query is to show a tutor's lessons with a specific student
                const allStudents = tutor.members.concat(tutor.formerStudents);
                if (objectArrIndex(allStudents, "student", req.query.studentId, "_id") > -1) {

                    //Check that user is either a student of this tutor, this tutor, or the course's teacher
                    if (allStudents[objectArrIndex(allStudents, "student", req.query.studentId, "_id")].student._id.equals(req.user._id) || (tutor.tutor._id.equals(req.user._id)) || (course.creator.equals(req.user._id))) {
                        return res.render('tutoringCenter/lessons', {
                            platform, course, tutor, student: allStudents[objectArrIndex(allStudents, "student", req.query.studentId, "_id")], objectArrIndex,
                            time: lessonMap.get(allStudents[objectArrIndex(allStudents, "student", req.query.studentId, "_id")].student._id.toString()), 
                            cost: costMap.get(allStudents[objectArrIndex(allStudents, "student", req.query.studentId, "_id")].student._id.toString()),
                            data: platform.features[objectArrIndex(platform.features, "route", "tutoringCenter")]
                        });
                    }
                    req.flash('error', "You do not have permission to view that student");
                    return res.redirect('back');
                }
                
                req.flash('error', "You do not have permission to view that student");
                return res.redirect('back');
            }

            //Display full profile with all necessary data
            return res.render('tutoringCenter/tutor-show', {
                platform, course, tutor, students: members, studentIds, averageRating,
                lessons: lessonMap, courses: enrolledCourses, objectArrIndex,
                data: platform.features[objectArrIndex(platform.features, "route", "tutoringCenter")]
            });
        }
    }
}

module.exports = controller;