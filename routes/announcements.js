const express = require('express');
const middleware = require('../middleware');
const router = express.Router(); //start express router
const dateFormat = require('dateformat');
const User = require('../models/user');
const Announcement = require('../models/announcement');

// display create form
router.get('/new', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  res.render('announcements/new');
});

// show announcement
router.get('/:id', middleware.isLoggedIn, (req, res) => {
  Announcement.findById(req.params.id)
  .populate({path: 'sender', select: 'username'})
  .exec((err, foundAnn) => {
    if (err || !foundAnn) {
      req.flash('error', 'Unable to access database');
      res.redirect('back');

    } else {
      res.render('announcements/index', {announced: true, announcement: foundAnn});
    }
  });
});

// display edit form
router.get('/:id/edit', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  Announcement.findById(req.params.id, (err, foundAnn) => {
    if (err || !foundAnn) {
      req.flash('error', "Unable to access database");
      res.redirect('back');
    } else if(!foundAnn.sender._id.equals(req.user._id)) {
      req.flash('error', 'You do not have permission to do that');
      res.redirect('back');
    } else {
      res.render('announcements/edit', {announcement: foundAnn});
    }
  })
})

// create announcement
router.post('/create', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  Announcement.create({sender: req.user, subject: req.body.subject, text: req.body.message}, (err, announcement) => {
    if(err || !announcement) {
      req.flash('error', 'Unable to access database');
      return res.redirect('back');
    }
    if (req.body.images["0"]) {
      for(const image in req.body.images) {
        announcement.images.push(req.body.images[image]);
      }
    }
    announcement.date = dateFormat(announcement.created_at, "mmm d, h:MMTT");
    announcement.save();

    req.flash('success', 'Announcement posted to bulletin!');
    res.redirect('/announcements/new');
  });
})

// edit announcement
router.put('/:id', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  Announcement.findByIdAndUpdate(req.params.id, {subject: req.body.subject, text: req.body.message}, (err, foundAnn) => {
    if (err || !foundAnn) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else if (!foundAnn.sender._id.equals(req.user._id)) {
      req.flash('error', "You can only edit announcements that you have sent.")
      res.redirect('back')

    } else {
      foundAnn.images = [];
      if(req.body.images["0"]) {
        for(const image in req.body.images) {
          foundAnn.images.push(req.body.images[image]);
        }
      }
      
      foundAnn.save();

      req.flash('success', 'Announcement Updated!');
      res.redirect(`/announcements/${foundAnn._id}`);
    }
  })
})

// delete announcement
router.delete('/:id', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  Announcement.findByIdAndDelete(req.params.id, (err, deletedAnn) => {
    if (err || !deletedAnn) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else if (foundAnn.sender._id != req.user._id) {
      req.flash('error', "You can only delete announcements that you have sent.")
      res.redirect('back')

    } else {
      req.flash('success', 'Deleted');
      res.redirect('/announcements/new');
    }
  })
})

module.exports = router;
