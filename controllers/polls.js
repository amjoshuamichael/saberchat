const setup = require("../utils/setup");

//SCHEMA
const Platform = require("../models/platform");
const User = require('../models/user');
const Poll = require('../models/poll');

const controller = {}

controller.index = async function(req, res) {
    const platform = await setup(Platform);
    const featureIndex = platform.features.findIndex(i => i.route === 'polls');

    const polls = await Poll.find({});

    res.render('polls/index', {
        platform, 
        polls,
        data: platform.features[featureIndex]
    });
}

module.exports = controller;