const express = require('express')
const {multipleUpload} = require('../middleware/multer');
const {validateUserUpdate, validateEmailUpdate, validatePasswordUpdate} = require('../middleware/validation');
const middleware = require('../middleware');
const wrapAsync = require("../utils/wrapAsync");
const profile = require("../controllers/profile"); //Controller
const router = express.Router(); //Router

router.route('/')
    .get(middleware.isLoggedIn, wrapAsync(profile.index)) // renders the list of users page
    .put(middleware.isLoggedIn, multipleUpload, validateUserUpdate, wrapAsync(profile.update));

router.get('/edit', middleware.isLoggedIn, profile.edit); //renders profiles edit page
router.get('/change-login-info', middleware.isLoggedIn, profile.changeLoginInfo); //renders the email/password edit page
router.get('/confirm-email/:id', wrapAsync(profile.confirmEmail)); //Confirm new email
router.get('/:id', middleware.isLoggedIn, wrapAsync(profile.show)); //Show specific user's profile

router.put('/profile', middleware.isLoggedIn, multipleUpload, validateUserUpdate, wrapAsync(profile.profilePut)); // update user route.
router.put('/tag', middleware.isAdmin, wrapAsync(profile.tagPut)); //Update user's tags
router.put('/change-email', middleware.isLoggedIn, validateEmailUpdate, wrapAsync(profile.changeEmailPut)); //route for changing email
router.put('/change-password', middleware.isLoggedIn, validatePasswordUpdate, wrapAsync(profile.changePasswordPut)); //route for changing password
router.put('/follow/:id', wrapAsync(profile.follow)); //Follow user
router.put('/unfollow/:id', wrapAsync(profile.unfollow)); //Unfollow user
router.put('/remove/:id', wrapAsync(profile.remove)); //Remove/block user

// router.delete('/delete-account', middleware.isLoggedIn, wrapAsync(profile.deleteAccount));

module.exports = router;