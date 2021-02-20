//Homework routes control the creation and management of courses, as well as tutors-student relations

const express = require('express');
const middleware = require('../middleware');
const {validateCourse} = require('../middleware/validation');
const {validatePostComment} = require('../middleware/validation');
const {singleUpload} = require('../middleware/multer');
const wrapAsync = require('../utils/wrapAsync');
const hw = require('../controllers/homework'); //Controller
const router = express.Router(); //Router

//General routes
router.route('/')
    .get(middleware.isLoggedIn, wrapAsync(hw.index)) //View index
    .post(middleware.isLoggedIn, middleware.isFaculty, singleUpload, validateCourse, wrapAsync(hw.createCourse)); //Create new course

//Course-specific routes
router.route('/:id')
    .get(middleware.isLoggedIn, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.showCourse)) //View specific course
    .put(middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), singleUpload, wrapAsync(hw.updateSettings)) //Update specific course's settings
    .delete(middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.deleteCourse)); //Delete course

//Show a specific tutor
router.get('/tutors/:id', middleware.isLoggedIn, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.showTutor)); //RESTful routing "tutors/show" page

//Join/leave requests
router.post('/join', middleware.isLoggedIn, wrapAsync(middleware.notMemberOfCourse), wrapAsync(hw.joinCourse)) //Join course as tutor or student
router.post('/unenroll-student/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.unenrollStudent)); //Leave course as a student
router.post('/unenroll-tutor/:id', middleware.isLoggedIn, middleware.isTutor, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.unenrollTutor)); //Leave course as a tutor

//Teacher put requests
router.put('/updateTeacher/:id', middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.updateTeacher)); //Update course teacher
router.put('/joinCode/:id', middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.updateJoinCode)); //Update course join code
router.put('/remove-student/:id', middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.removeStudent)); //For teachers to remove students from courses
router.put('/remove-tutor/:id', middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.removeTutor)); //For teachers to remove tutors from courses
router.put('/unblock/:id', middleware.isLoggedIn, middleware.isFaculty, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.unblock)); //Unblock a blocked user

//Tutor put requests
router.put("/bio/:id", middleware.isLoggedIn, middleware.isTutor, wrapAsync(hw.updateBio)); //Edit tutor bio
router.put('/close-lessons/:id', middleware.isLoggedIn, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.closeLessons)); //For a tutor to make themself unavailable
router.put('/reopen-lessons/:id', middleware.isLoggedIn, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.reopenLessons)); //For a tutor to make themself available to students
router.put('/set-students/:id', middleware.isTutor, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.setStudents)); //For tutors to set student capacity
router.put("/mark/:id", middleware.isLoggedIn, middleware.isTutor, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.markLesson)); //Mark a student's lesson

//Student put requests
router.put('/book/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.bookTutor)); //Book a tutor
router.put('/leave/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.leaveTutor)); //Leave Tutor
router.put('/upvote/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(middleware.memberOfCourse), wrapAsync(hw.upvoteTutor)); //Upvote a tutor
router.put('/rate/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(middleware.memberOfCourse), validatePostComment, wrapAsync(hw.rateTutor)); //Submit a review for a tutor
router.put('/like-review/:id', middleware.isLoggedIn, middleware.isStudent, wrapAsync(hw.likeReview)); //Like a tutor's review

module.exports = router;