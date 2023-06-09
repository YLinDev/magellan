const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = mongoose.model('User');
const passport = require('passport');
const { loginUser, restoreUser } = require('../../config/passport');
const { isProduction } = require('../../config/keys');
const validateRegisterInput = require('../../validations/register');
const validateLoginInput = require('../../validations/login');
const { singleFileUpload, singleMulterUpload } = require("../../awsS3");
const { getLatLng } = require('../../config/geocode');
const { googleAPIKey } = require('../../config/keys');
const { Client } = require('@googlemaps/google-maps-services-js');
const Quest = mongoose.model('Quest');
const Event = mongoose.model('Event');
const Review = require('../../models/Review');
const { events } = require('../../models/Review');

router.post("/register", validateRegisterInput, async (req, res, next) => {
  const user = await User.findOne({email: req.body.email});

  if (user) {
    const err = new Error("Validation Error");
    err.statusCode = 400;
    const errors = {};
    if (user.email === req.body.email) {
      errors.email = "A user has already registered with this email";
    }
    err.errors = errors;
    return next(err);
  }

  const client = new Client();
  const address = `${req.body.homeCity}, ${req.body.homeState}`;
  const response = await client.geocode({ params: { address, key: googleAPIKey } });
  if (!response.data.results[0]) {
    const err = new Error("Validation Error");
    err.statusCode = 400;
    const errors = {};
    errors.homeCity = "Invalid home city and state"
    err.errors = errors;
    return next(err);
  }

  const latlng = await getLatLng(`${req.body.homeCity}, ${req.body.homeState}`);
  const latInput = latlng[0];
  const lngInput = latlng[1];

  const newUser = new User({
    email: req.body.email,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    homeCity: req.body.homeCity,
    homeState: req.body.homeState,
    lat: latInput,
    lng: lngInput,
    profileImageUrl: req.body.profileImageUrl
  });

  bcrypt.genSalt(10, (err, salt) => {
    if (err) throw err;
    bcrypt.hash(req.body.password, salt, async (err, hashedPassword) => {
      if (err) throw err;
      try {
        newUser.hashedPassword = hashedPassword;
        const user = await newUser.save();
        return res.json(await loginUser(user));
      }
      catch(err) {
        next(err);
      }
    })
  });
});

router.post('/login', singleMulterUpload("image"), validateLoginInput, async (req, res, next) => {
  passport.authenticate('local', async function(err, user) {
    if (err) return next(err);
    if (!user) {
      const err = new Error('Invalid credentials');
      err.statusCode = 400;
      err.errors = { email: "Invalid credentials" };
      return next(err);
    }
    return res.json(await loginUser(user));
  })(req, res, next);
});

router.get('/current', restoreUser, (req, res) => {
  if (!isProduction) {
    const csrfToken = req.csrfToken();
    res.cookie("CSRF-TOKEN", csrfToken);
  }
  if (!req.user) return res.json(null);
  res.json({
    _id: req.user._id,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    profileImageUrl: req.user.profileImageUrl,
    email: req.user.email,
    homeCity: req.user.homeCity,
    homeState: req.user.homeState
  });
});

router.get('/:userId/events', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);

    const hostedEvents = await Event.find({host: user})
    const attendedEvents = await Event.find({attendees: user})
    const events = {...hostedEvents, ...attendedEvents};
    return res.json(events);
  } catch(err) {
    const error = new Error('User not found');
    error.statusCode = 404;
    error.errors = { message: "No user found with that id" };
    return next(error);
  }
})

router.get('/:userId', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);

    const userInfo = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      homeCity: user.homeCity,
      homeState: user.homeState
    };
    return res.json(userInfo);
  } catch(err) {
    const error = new Error('User not found');
    error.statusCode = 404;
    error.errors = { message: "No user found with that id" };
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try{
    const users = await User.find();
    const usersArray = Object.values(users);
    const usersObject = {};

    usersArray.forEach((user)=>{
      const userInfo = {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl
      };
      usersObject[user._id] = userInfo;
    })

    return res.json({users: usersObject});
  } catch{
    const error = new Error('Event not found');
    error.statusCode = 404;
    error.errors = { message: "No event found with that id" };
    return next(error);
  }
});

router.patch('/:userId', async (req, res, next) => {
  const user = await User.findById(req.params.userId);

  if (!user) {
    const err = new Error("Validation Error");
    err.statusCode = 400;
    const errors = {};
    if (user.email === req.body.email) {
      errors.email = "No user found";
    }
    err.errors = errors;
    return next(err);
  }

  const client = new Client();
  const address = `${req.body.homeCity}, ${req.body.homeState}`;
  const response = await client.geocode({ params: { address, key: googleAPIKey } });
  if (!response.data.results[0]) {
    const err = new Error("Validation Error");
    err.statusCode = 400;
    const errors = {};
    errors.homeCity = "Invalid home city and state"
    err.errors = errors;
    return next(err);
  }

  const latlng = await getLatLng(`${req.body.homeCity}, ${req.body.homeState}`);
  const latInput = latlng[0];
  const lngInput = latlng[1];

  user.email = req.body.email;
  user.firstName = req.body.firstName;
  user.lastName = req.body.lastName;
  user.homeCity = req.body.homeCity;
  user.homeState = req.body.homeState;
  user.lat = latInput;
  user.lng = lngInput;
  user.profileImageUrl = req.body.profileImageUrl;

  try {
    const updatedUser = await user.save()
    return res.json(await loginUser(updatedUser))
  } catch(err) {
    next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  const user = await User.findById(req.params.userId);
  const userEvents = await Event.find({host: req.params.userId});
  const userReviews = await Review.find({author: req.params.userId});
  const userQuests = await Quest.find({creator: req.params.userId});
  const userQuestIds = userQuests.map((userQuest) => userQuest._id.toString())

  let relatedEvents = [];
  let relatedReviews = [];
  let allEvents = await Event.find();
  let allReviews = await Review.find();
  allEvents.forEach((event)=>{
    if (userQuestIds.includes(event.quest.toString())) {
      relatedEvents.push(event);
    }
    if (event.attendees.includes(req.params.userId)) {
      let idx = event.attendees.findIndex((el) => el === req.params.userId);
      event.attendees.splice(idx, 1)
    }
  })
  allReviews.forEach((review) => {
    if (userQuestIds.includes(review.quest.toString())) {
      relatedReviews.push(review);
    }
  })

  const deleteReviews = [...userReviews, ...relatedReviews];
  const deleteEvents = [...userEvents, ...relatedEvents];
try {
  deleteReviews.forEach((review) => {
    review.deleteOne();
  })
  deleteEvents.forEach((event) => {
    event.deleteOne();
  })
  userQuests.forEach((userQuest) => {
    userQuest.deleteOne();
  })
  user.deleteOne();
  return res.json(user);
} catch(err) {
  next(err);
}
});

module.exports = router;