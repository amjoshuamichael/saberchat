const express = require('express');
const middleware = require('../middleware');
const router = express.Router(); //start express router
const User = require('../models/user');
const Announcement = require('../models/announcement')
const Project = require('../models/project');

router.get('/projects', middleware.isLoggedIn, (req, res) => {
  Project.find({}, (err, foundProjects) => {
    if (err || !foundProjects) {
      console.log(err)
      req.flash('error', 'Unable to access database')
      res.redirect('back')

    } else {

      Announcement.find({}).populate({path: 'sender', select: ['username', 'imageUrl']}).populate('message').exec((err, foundAnns) => {
        if (err || !foundAnns) {
          req.flash('error', 'Unable to access database')
          res.redirect('back')
        } else {
          res.render('projects/projects', {announcements: foundAnns, projects: foundProjects})
        }
      })
    }
  })
})

router.get('/addProject', middleware.isLoggedIn, (req, res) => {
  User.find({permission: 'student'}, (err, foundUsers) => {
    if (err || !foundUsers) {
      console.log(err)
      req.flash('error', 'Unable to access database')
      res.redirect('back')

    } else {
      Announcement.find({}).populate({path: 'sender', select: ['username', 'imageUrl']}).populate('message').exec((err, foundAnns) => {
        if (err || !foundAnns) {
          req.flash('error', 'Unable to access database')
          res.redirect('back')
        } else {
          res.render('projects/addProject', {announcements: foundAnns, students: foundUsers})
        }
      })
    }
  })
})

router.post('/submitProject', (req, res) => {
  Project.create({title: req.body.title, imgUrl: req.body.img, text: req.body.text, poster: req.user.username, creators: req.body.creators.split(', ')}, (err, project) => {
    if (err || !project) {
      console.log(err)
      req.flash('error', 'Unable to save project')
      res.redirect('back')

    } else {
      project.save()
      req.flash('success', 'Project posted!')
			res.redirect('/addProject')
    }
    })

})

module.exports = router;
