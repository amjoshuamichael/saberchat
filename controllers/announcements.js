//LIBRARIES
const {sendGridEmail} = require("../services/sendGrid");
const {convertToLink, embedLink} = require("../utils/convert-to-link");
const {objectArrIndex, removeIfIncluded, parsePropertyArray} = require("../utils/object-operations");
const setup = require("../utils/setup");
const path = require('path');
const dateFormat = require('dateformat');
const {cloudUpload, cloudDelete} = require('../services/cloudinary');
const {autoCompress} = require("../utils/image-compress");

//SCHEMA
const Platform = require("../models/platform");
const User = require('../models/user');
const {Announcement, PostComment} = require('../models/post');
const {InboxMessage} = require('../models/notification');

const controller = {};

// Announcement GET index
controller.index = async function(req, res) {
    const platform = await setup(Platform);
    const users = await User.find({authenticated: true});
    if (!platform || !users) {
        req.flash('error', 'An Error Occurred');
        return res.redirect('back');
    }

    let announcements;
    if (req.user && await platform.permissionsProperty.slice(platform.permissionsProperty.length-3).includes(req.user.permission)) {
        announcements = await Announcement.find({}).populate('sender');
    } else if (!req.user) {
        announcements = await Announcement.find({verified: true, public: { $ne: false }}).populate('sender');
    } else {
        announcements = await Announcement.find({verified: true}).populate('sender');
    }
    if(!announcements) {
        req.flash('error', 'Cannot find announcements.');
        return res.redirect('back');
    }

    const userNames = parsePropertyArray(users, "firstName").join(',').toLowerCase().split(',');
    const announcementTexts = await embedLink(req.user, announcements, userNames);

    return res.render('announcements/index', {platform, announcements: await announcements.reverse(), announcementTexts});
};

// Announcement GET new ann
controller.new = async function(req, res) {
    const platform = await setup(Platform);
    if (!platform) {
        req.flash("error", "An Error Occurred");
        return res.redirect("back");
    }
    return res.render('announcements/new', {platform});
};

// Announcement GET markall ann as read
controller.markAll = async function(req, res) {
    req.user.annCount = []; //No new announcements in user's annCount
    await req.user.save();
    req.flash('success', 'All Announcements Marked As Read!');
    return res.redirect(`/announcements`);
};

// Announcement GET mark one ann as read
controller.markOne = async function(req, res) {
    if (objectArrIndex(req.user.annCount, "announcement", req.params.id) > -1) { //If user's annCount includes announcement, remove it
        await req.user.annCount.splice(objectArrIndex(req.user.annCount, "announcement", req.params.id), 1);
        await req.user.save();
    }
    req.flash('success', 'Announcement Marked As Read!');
    return res.redirect(`/announcements`);
};

// Announcement GET show
controller.show = async function(req, res) {
    const platform = await setup(Platform);
    const announcement = await Announcement.findById(req.params.id)
        .populate('sender')
        .populate({
            path: "comments",
            populate: {path: "sender"}
        });
    if(!platform || !announcement) {
        req.flash('error', 'Could not find announcement');
        return res.redirect('back');
    } else if (!announcement.verified && !(await platform.permissionsProperty.slice(platform.permissionsProperty.length-3).includes(req.user.permission))) {
        req.flash('error', 'You cannot view that announcement');
        return res.redirect('back');
    }

    if(req.user) {
        //If this announcement is new to the user, it is no longer new, so remove it
        if (objectArrIndex(req.user.annCount, "announcement", announcement._id, "_id") > -1) {
            await req.user.annCount.splice(objectArrIndex(req.user.annCount, "announcement", announcement._id, "_id"), 1);
            await req.user.save();
        }
    }

    let fileExtensions = new Map(); //Track which file format each attachment is in
    for (let media of announcement.mediaFiles) {
        fileExtensions.set(media.url, path.extname(media.url.split("SaberChat/")[1]));
    }
    const convertedText = await convertToLink(announcement.text); //Parse and add hrefs to all links in text
    return res.render('announcements/show', {platform, announcement, convertedText, fileExtensions});
};

// Announcement GET edit form
controller.updateForm = async function(req, res) {
    const platform = await setup(Platform);
    const announcement = await Announcement.findById(req.params.id);
    if(!platform || !announcement) {
        req.flash('error', 'Could not find announcement');
        return res.redirect('back');
    }
    if(!(await announcement.sender.equals(req.user._id))) { //Only the sender may edit the announcement
        req.flash('error', 'You do not have permission to do that.');
        return res.redirect('back');
    }

    let fileExtensions = new Map(); //Track which file format each attachment is in
    for (let media of announcement.mediaFiles) {
        fileExtensions.set(media.url, path.extname(await media.url.split("SaberChat/")[1]));
    }
    return res.render('announcements/edit', {platform, announcement, fileExtensions});
};

// Announcement POST create
controller.create = async function(req, res) {
    const platform = await setup(Platform);
    const announcement = await Announcement.create({
        sender: req.user,
        subject: req.body.subject,
        text: req.body.message,
        verified: !platform.postVerifiable //Announcement does not need to be verified if platform does not support verifying announcements
    });
    if (!platform || !announcement) {
        req.flash('error', 'Unable to create announcement');
        return res.redirect('back');
    }
    if (req.body.public && req.body.public === 'False') {
        announcement.public = false; // no access to visitors without accounts/not logged in
    }

    if (req.body.images) {announcement.images = req.body.images;} //If any images were added (if not, the 'images' property is empty)

    // if files were uploaded, process them
    if (req.files) {
        if (req.files.mediaFile) {
            let cloudErr;
            let cloudResult;
            for (let file of req.files.mediaFile) { //Upload each file to cloudinary
                const processedBuffer = await autoCompress(file.originalname, file.buffer);
                [cloudErr, cloudResult] = await cloudUpload(file.originalname, processedBuffer);
                if (cloudErr || !cloudResult) {
                    req.flash('error', 'Upload failed');
                    return res.redirect('back');
                }

                await announcement.mediaFiles.push({
                    filename: cloudResult.public_id,
                    url: cloudResult.secure_url,
                    originalName: file.originalname
                });
            }
        }
    }

    announcement.date = dateFormat(announcement.created_at, "h:MM TT | mmm d");
    await announcement.save();

    if (!platform.postVerifiable) {
        const users = await User.find({authenticated: true, _id: {$ne: req.user._id}});
        if (!users) {
            req.flash('error', "An Error Occurred");
            return res.redirect('back');
        }

        let imageString = ""; //Build string of all attached images
        for (const image of announcement.images) {imageString += `<img src="${image}">`;}
        for (let user of users) { //Send email to all users
            if (user.receiving_emails) {
                const emailText = `<p>Hello ${user.firstName},</p><p>${req.user.username} has recently posted a new announcement - '${announcement.subject}'.</p><p>${announcement.text}</p><p>You can access the full announcement at https://${platform.url}</p> ${imageString}`;
                await sendGridEmail(user.email, `New Saberchat Announcement - ${announcement.subject}`, emailText, false);
                await user.annCount.push({announcement, version: "new"});
                await user.save();
            }
        }
    }

    if (platform.postVerifiable) {
        req.flash('success', `Announcement Posted! A platform ${await platform.permissionsDisplay[platform.permissionsDisplay.length-1].toLowerCase()} will verify your post soon.`);
    } else {
        req.flash('success', `Announcement Posted!`);
    }
    return res.redirect(`/announcements`);
};

controller.verify = async function(req, res) {
    const platform = await setup(Platform);
    const announcement = await Announcement.findByIdAndUpdate(req.params.id, {verified: true}).populate("sender");
    if (!platform || !announcement) {
        req.flash('error', "Unable to access announcement");
        return res.redirect('back');
    }

    if (platform.postVerifiable) {
        const users = await User.find({authenticated: true, _id: {$ne: req.user._id}});
        if (!users) {
            req.flash('error', "An Error Occurred");
            return res.redirect('back');
        }

        let imageString = ""; //Build string of all attached images
        for (const image of announcement.images) {imageString += `<img src="${image}">`;}
        for (let user of users) { //Send email to all users
            if (user.receiving_emails) {
                const emailText = `<p>Hello ${user.firstName},</p><p>${announcement.sender.username} has recently posted a new announcement - '${announcement.subject}'.</p><p>${announcement.text}</p><p>You can access the full announcement at https://${platform.url}</p> ${imageString}`;
                await sendGridEmail(user.email, `New Saberchat Announcement - ${announcement.subject}`, emailText, false);
                await user.annCount.push({announcement, version: "new"});
                await user.save();
            }
        }
    }

    req.flash("success", "Verified Announcement!");
    return res.redirect("/announcements");
}

//Announcement PUT Update
controller.updateAnnouncement = async function(req, res) {
    const platform = await setup(Platform);
    const announcement = await Announcement.findById(req.params.id).populate('sender');
    if (!platform || !announcement) {
        req.flash('error', "Unable to access announcement");
        return res.redirect('back');
    }

    if ((await announcement.sender._id.toString()) != (await req.user._id.toString())) {
        req.flash('error', "You can only update announcements which you have sent");
        return res.redirect('back');
    }

    const updatedAnnouncement = await Announcement.findByIdAndUpdate(req.params.id, {
        subject: req.body.subject,
        text: req.body.message,
        verified: !platform.postVerifiable //Announcement does not need to be verified if platform does not support verifying announcements
    });
    if (!updatedAnnouncement) {
        req.flash('error', "Unable to update announcement");
        return res.redirect('back');
    }

    if (req.body.public && req.body.public === 'False') {
        updatedAnnouncement.public = false; // no access to visitors without accounts/not logged in
    } else {
        updatedAnnouncement.public = true;
    }

    if (req.body.images) {updatedAnnouncement.images = req.body.images;} //Only add images if any are provided

    //Iterate through all selected media to remove and delete them
    let cloudErr;
    let cloudResult;
    for (let i = updatedAnnouncement.mediaFiles.length-1; i >= 0; i--) {
        if (req.body[`deleteUpload-${updatedAnnouncement.mediaFiles[i].url}`] && updatedAnnouncement.mediaFiles[i] && updatedAnnouncement.mediaFiles[i].filename) {
            //Evaluate filetype to decide on file deletion strategy
            switch(path.extname(await updatedAnnouncement.mediaFiles[i].url.split("SaberChat/")[1]).toLowerCase()) {
                case ".mp3":
                case ".mp4":
                case ".m4a":
                case ".mov":
                    [cloudErr, cloudResult] = await cloudDelete(updatedAnnouncement.mediaFiles[i].filename, "video");
                    break;
                case ".pdf":
                    [cloudErr, cloudResult] = await cloudDelete(updatedAnnouncement.mediaFiles[i].filename, "pdf");
                    break;
                default:
                    [cloudErr, cloudResult] = await cloudDelete(updatedAnnouncement.mediaFiles[i].filename, "image");
            }

            // Check For Failure
            if (cloudErr || !cloudResult || cloudResult.result !== 'ok') {
                req.flash('error', 'Error deleting uploaded image');
                return res.redirect('back');
            }
            await updatedAnnouncement.mediaFiles.splice(i, 1);
        }
    }

    // if files were uploaded
    if (req.files) {
        if (req.files.mediaFile) {
            //Iterate through all new attached media
            for (let file of req.files.mediaFile) {
                const processedBuffer = await autoCompress(file.originalname, file.buffer);
                [cloudErr, cloudResult] = await cloudUpload(file.originalname, processedBuffer);
                if (cloudErr || !cloudResult) {
                    req.flash('error', 'Upload failed');
                    return res.redirect('back');
                }

                await updatedAnnouncement.mediaFiles.push({
                    filename: cloudResult.public_id,
                    url: cloudResult.secure_url,
                    originalName: file.originalname
                });
            }
        }
    }

    await updatedAnnouncement.save();
    const users = await User.find({authenticated: true, _id: {$ne: req.user._id}});
    if (!users) {
        req.flash('error', "An Error Occurred");
        return res.redirect('back');
    }

    let imageString = "";
    for (let image of announcement.images) {imageString += `<img src="${image}">`;}
    for (let user of users) {
        //If announcement not already in user's annCount, add it
        if (objectArrIndex(user.annCount, "announcement", updatedAnnouncement._id) == -1) {
            await user.annCount.push({announcement: updatedAnnouncement, version: "updated"});
            await user.save();
        }
    }

    req.flash('success', 'Announcement Updated!');
    return res.redirect(`/announcements`);
}

// Announcement PUT like ann
controller.likeAnnouncement = async function(req, res) {
    const announcement = await Announcement.findById(req.body.announcementId);
    if(!announcement) {return res.json({error: 'Error updating announcement.'});}

    if (removeIfIncluded(announcement.likes, req.user._id)) { //Remove like
        await announcement.save();
        return res.json({
            success: `Removed a like from ${announcement.subject}`,
            likeCount: announcement.likes.length
        });
    }
    
    await announcement.likes.push(req.user._id);
    await announcement.save();
    return res.json({
        success: `Liked ${announcement.subject}`,
        likeCount: announcement.likes.length
    });
};

// Announcement PUT comment
controller.comment = async function(req, res) {
    const announcement = await Announcement.findById(req.body.announcementId)
        .populate({
            path: "comments",
            populate: {path: "sender"}
        });
    if (!announcement) {return res.json({error: 'Error commenting'});}

    const comment = await PostComment.create({
        text: await req.body.text.split('<').join('&lt'),
        sender: req.user
    });
    if (!comment) {return res.json({error: 'Error commenting'});}

    comment.date = dateFormat(comment.created_at, "h:MM TT | mmm d");
    await comment.save();

    await announcement.comments.push(comment);
    await announcement.save();

    let users = [];
    let user;
    for (let line of await comment.text.split(" ")) {
        if (line[0] == '@') {
            user = await User.findById(await line.split("#")[1].split("_")[0]);
            if (!user) {return res.json({error: "Error accessing user"});}
            await users.push(user);
        }
    }

    let notif;
    for (let user of users) {
        notif = await InboxMessage.create({
            subject: `New Mention in ${announcement.subject}`,
            author: req.user,
            noReply: true,
            recipients: [user],
            read: [],
            toEveryone: false,
            images: []
        });
        if (!notif) {return res.json({error: "Error creating notification"});}

        notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");
        notif.text = `Hello ${user.firstName},\n\n${req.user.firstName} ${req.user.lastName} mentioned you in a comment on "${announcement.subject}":\n${comment.text}`;
        await notif.save();

        if (user.receiving_emails) {
            await sendGridEmail(user.email, `New Mention in ${announcement.subject}`, `<p>Hello ${user.firstName},</p><p>${req.user.firstName} ${req.user.lastName} mentioned you in a comment on <strong>${announcement.subject}</strong>.<p>${comment.text}</p>`, false);
        }

        await user.inbox.push({message: notif, new: true}); //Add notif to user's inbox
        await user.save();
    }

    return res.json({
        success: 'Successful comment',
        comments: announcement.comments
    });
}

// Announcement PUT like comment
controller.likeComment = async function(req, res) {
    const comment = await PostComment.findById(req.body.commentId);
    if(!comment) {return res.json({error: 'Error finding comment'});}

    if (removeIfIncluded(comment.likes, req.user._id)) {
        await comment.save();
        return res.json({
            success: `Removed a like`,
            likeCount: comment.likes.length
        });
    }

    await comment.likes.push(req.user._id); //Add Like
    await comment.save();
    return res.json({
        success: `Liked comment`,
        likeCount: comment.likes.length
    });
}

controller.deleteAnnouncement = async function(req, res) {
    const announcement = await Announcement.findById(req.params.id).populate('sender');
    if (!announcement) {
        req.flash('error', "Unable to access announcement");
        return res.redirect('back');
    }

    if ((await announcement.sender._id.toString()) != (await req.user._id.toString())) {
        req.flash('error', "You can only delete announcements that you have posted");
        return res.redirect('back');
    }
    
    // delete any uploads
    let cloudErr;
    let cloudResult;
    for (let file of announcement.mediaFiles) {
        if (file && file.filename) {
            //Evaluate deleted files' filetype and delete accordingly
            switch(path.extname(await file.url.split("SaberChat/")[1]).toLowerCase()) {
                case ".mp3":
                case ".mp4":
                case ".m4a":
                case ".mov":
                    [cloudErr, cloudResult] = await cloudDelete(file.filename, "video");
                    break;
                case ".pdf":
                    [cloudErr, cloudResult] = await cloudDelete(file.filename, "pdf");
                    break;
                default:
                    [cloudErr, cloudResult] = await cloudDelete(file.filename, "image");
            }

            // check for failure
            if (cloudErr || !cloudResult || cloudResult.result !== 'ok') {
                req.flash('error', 'Error deleting uploaded image');
                return res.redirect('back');
            }
        }
    }

    const deletedAnnouncement = await Announcement.findByIdAndDelete(announcement._id);
    if (!deletedAnnouncement) {
        req.flash('error', "Unable to delete announcement");
        return res.redirect('back');
    }

    const users = await User.find({authenticated: true});
    if (!users) {
        req.flash('error', "Unable to find users");
        return res.redirect('back');
    }

    for (let user of users) {
        if (objectArrIndex(user.annCount, "announcement", deletedAnnouncement._id) > -1) {
            await user.annCount.splice(objectArrIndex(user.annCount, "announcement", deletedAnnouncement._id), 1);
            await user.save();
        }
    }

    req.flash('success', 'Announcement Deleted!');
    return res.redirect('/announcements');
}

module.exports = controller;