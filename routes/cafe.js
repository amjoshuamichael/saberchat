//Cafe routes control the creation of orders, and the creation an modification of items and items types

//LIBRARIES
const express = require('express');
const middleware = require('../middleware');
const router = express.Router();
const dateFormat = require('dateformat');
const nodemailer = require('nodemailer');

//SCHEMA
const User = require('../models/user');
const Order = require('../models/order');
const Item = require('../models/orderItem');
const Notification = require('../models/message');
const Type = require('../models/itemType');
const Cafe = require('../models/cafe')

let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'noreply.saberchat@gmail.com',
    pass: 'Tgy8erwIYtxRZrJHvKwkWbrkbUhv1Zr9'
  }
});

//ROUTES
router.get('/', middleware.isLoggedIn, (req, res) => { //RESTful routing 'order/index' route
  Order.find({customer: req.user._id})
  .populate('items.item').exec((err, foundOrders) => { //Find all of the orders that you have ordered, and populate info on their items

    if (err || !foundOrders) {

      req.flash('error', "Could not find your orders");
      console.log(err);
      res.redirect('back');

    } else {
      res.render('cafe/index', {orders: foundOrders});
    }
  });
});

router.get('/menu', middleware.isLoggedIn, (req, res) => { //Renders the cafe menu with info on all the items

  Type.find({}).populate('items').exec((err, foundTypes) => { //Collects info on every item type, to render (in frontend, the ejs checks each item inside type, and only shows it if it's available)
    if (err || !foundTypes) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else {
      res.render('cafe/menu', {types: foundTypes});
    }
  })
})

router.get('/data', middleware.isLoggedIn, middleware.isAdmin, (req, res) => {
  (async() => {

    //Evaluate our most common customers

    const customers = await User.find({});
    if (!customers) {
      req.flash('error', "Unable to find customers");
      return res.redirect('back');
    }

    let popularCustomers = []; //Most orders
    let longestOrderCustomers = []; //Longest orders by item
    let lucrativeCustomers = []; //Most money spent at the cafe

    let customerOrdersObject;

    let customerOrders;
    let orderTotal;

    for (let customer of customers) {
      orderTotal = 0;

      customerOrders = await Order.find({'customer': customer._id});

      if (!customerOrders) {
        req.flash('error', "Unable to find orders");
        return res.redirect('back');
      }

      customerOrdersObject = {
        customer: customer,
        orderLength: 0
      };

      for (let order of customerOrders) {
        orderTotal += order.charge;

        for (let item of order.items) {
          customerOrdersObject.orderLength += item.quantity;
        }
      }

      customerOrdersObject.orderLength/= customerOrders.length;

      if (customerOrders.length > 0) {
        popularCustomers.push({customer: customer, orderCount: customerOrders.length});
        lucrativeCustomers.push({customer: customer, spent: orderTotal, avgCharge: (orderTotal/customerOrders.length)});
        longestOrderCustomers.push(customerOrdersObject);
      }

    }

    //Sort customers in all three arrays - popularity by number of orders, longest orders, and most charge
    let tempCustomer;
    for (let h = 0; h < popularCustomers.length; h++) {
      for (let i = 0; i < popularCustomers.length - 1; i ++) {
        if (popularCustomers[i].orderCount < popularCustomers[i+1].orderCount) {
          tempCustomer = popularCustomers[i];
          popularCustomers[i] = popularCustomers[i+1];
          popularCustomers[i+1] = tempCustomer;
        }

        if (longestOrderCustomers[i].orderLength < longestOrderCustomers[i+1].orderLength) {
          tempCustomer = longestOrderCustomers[i];
          longestOrderCustomers[i] = longestOrderCustomers[i+1];
          longestOrderCustomers[i+1] = tempCustomer;
        }

        if (lucrativeCustomers[i].spent < lucrativeCustomers[i+1].spent) {
          tempCustomer = lucrativeCustomers[i];
          lucrativeCustomers[i] = lucrativeCustomers[i+1];
          lucrativeCustomers[i+1] = tempCustomer;
        }

      }
    }

    //Evaluate the most purchased items

    const items = await Item.find({});
    if (!items) {
      req.flash('error', "Unable to find items");
      return res.redirect('back');
    }

    let popularItems = [];
    let itemObject;
    let itemTotal;

    let orderedQuantities = []; //Typically how much of an item is ordered in one go
    let itemQuantityArray = [0, 0, 0];

    let itemOrders = await Order.find({});
    if (!itemOrders) {
      req.flash('error', "Unable to find orders");
      return res.redirect('back');
    }

    for (let item of items) {
      itemTotal = 0;
      itemQuantityArray = [0, 0, 0];

      for (let order of itemOrders) {
        for (let it of order.items) {
          if (it.item.toString() == item._id.toString()) {
            itemTotal += it.quantity;
            itemQuantityArray[it.quantity-1] += 1;
          }
        }
      }

      itemObject = {
        item: item,
        orderCount: itemTotal
      };

      if (itemObject.orderCount > 0) {
        popularItems.push(itemObject);
      }

      let orderedQuantityObject = {
        item: item,
        numOrders: 0,
        sumOrders: 0,
        avgQuantity: 0
      };

      for (let i = 0; i < itemQuantityArray.length; i ++) {
        orderedQuantityObject.numOrders += itemQuantityArray[i];
        orderedQuantityObject.sumOrders += ((i+1) * itemQuantityArray[i]);
      }

      orderedQuantityObject.avgQuantity  = orderedQuantityObject.sumOrders/orderedQuantityObject.numOrders;

      if (!isNaN(orderedQuantityObject.avgQuantity)) {
        orderedQuantities.push(orderedQuantityObject);
      }

    }

    //Sort items
    let tempItem;
    for (let h = 0; h < popularItems.length; h++) {
      for (let i = 0; i < popularItems.length - 1; i ++) {
        if (popularItems[i].orderCount < popularItems[i+1].orderCount) {
          tempItem = popularItems[i];
          popularItems[i] = popularItems[i+1];
          popularItems[i+1] = tempItem;
        }
      }
    }

    //Calculate most common item combinations

    const orders = await Order.find({});
    if (!orders) {
      req.flash('error', "Unable to find orders");
      return res.redirect('back');
    }

    let combinations = []; //Matrix of common order combinations
    let combo = [];
    let overlap;

    //Initialize combinations matrix with first order

    for (let item of orders[0].items) {
      combo.push(item.item.toString());
    }

    combo.sort(); //Sort the combination so it can be easily compared with all other combinations

    combinations.push({combination: combo, instances: 1});

    for (let order of orders.slice(1)) {
      combo = []
      overlap = false;

      for (let item of order.items) {
        combo.push(item.item.toString());
      }

      combo.sort();

      for (let c of combinations) {
        if (combo.toString() == c.combination.toString()) { //Compare the sorted arrays by making them strings
          c.instances ++;
          overlap = true;
          break;
        }
      }

      if (!overlap) {
        combinations.push({combination: combo, instances: 1});
      }
    }

    //Sort combinations
    let tempCombo;
    for (let h = 0; h < combinations.length; h++) {
      for (let i = 0; i < combinations.length - 1; i ++) {
        if (combinations[i].instances < combinations[i+1].instances) {
          tempCombo = combinations[i];
          combinations[i] = combinations[i+1];
          combinations[i+1] = tempCombo;
        }
      }
    }

    let populatedCombinations = [];
    let populatedCombination;
    let populatedItem;

    for (let combo of combinations) {
      populatedCombination = [];

      for (let item of combo.combination) {
        populatedItem = await Item.findById(item);
        if (!populatedItem) {
          req.flash('error', "Umable to find item");
          return res.redirect('back');
        }
        populatedCombination.push(populatedItem);
      }
      populatedCombinations.push({combination: populatedCombination, instances: combo.instances});
    }

    //Calculate popularity at various price points

    let pricepoints = new Map();

    for (let item of items) {
      pricepoints.set(item._id.toString(), new Map());
    }

    for (let order of orders) {
      for (let it of order.items) {
        if (pricepoints.get(it.item._id.toString()).has(it.price)) {
          pricepoints.get(it.item._id.toString()).set(it.price, pricepoints.get(it.item._id.toString()).get(it.price)+1);

        } else {
          pricepoints.get(it.item._id.toString()).set(it.price, 1);
        }
      }
    }

    //Calculate most common timeframes

    let times = [];
    let timeCount = []; //Using matrix instead of map to count number of repetitions of a time so it can be sortable
    let time;
    let index; //Index of overlapping time in the matrix of times

    for (let order of orders) { //Orders already declared from earlier
      index = -1;
      time = order.date.split(', ')[1];

      if (time.split(' ')[1] == "AM") {

        if (time.split(':')[0] == '12') {
          time = `00:${time.split(':')[1].split(' ')[0]}`;

        } else {
          time = `${time.split(' ')[0]}`;
        }

      } else {
        if (time.split(':')[0] == '12') {
          time = `12:${time.split(':')[1].split(' ')[0]}`;

        } else {
          time = `${(parseInt(time.split(':')[0])+12).toString()}:${time.split(':')[1].split(' ')[0]}`;
        }
      }

      times.push(time)

      //Populate matrix of time counts accordingly
      for (let i = 0; i < timeCount.length; i ++) {
        if (timeCount[i][0] == time)  {
          index = i;
          break;
        }
      }

      if (index != -1) {
        timeCount[index][1] += 1;

      } else {
        timeCount.push([time, 1]);
      }
    }

    //Sort times

    let tempTime;
    for (let h = 0; h < times.length; h++) {
      for (let i = 0; i < times.length - 1; i ++) {
        if (parseInt(`${times[i].split(':')[0]}${times[i].split(':')[1]}`) > parseInt(`${times[i+1].split(':')[0]}${times[i+1].split(':')[1]}`)) {
          tempTime = times[i];
          times[i] = times[i+1];
          times[i+1] = tempTime;
        }
      }
    }

    for (let h = 0; h < timeCount.length; h++) {
      for (let i = 0; i < timeCount.length - 1; i ++) {
        if (parseInt(`${timeCount[i][0].split(':')[0]}${timeCount[i][0].split(':')[1]}`) > parseInt(`${timeCount[i+1][0].split(':')[0]}${timeCount[i+1][0].split(':')[1]}`)) {
          tempTime = timeCount[i];
          timeCount[i] = timeCount[i+1];
          timeCount[i+1] = tempTime;
        }
      }
    }

    let timesObject = { //This object stores the formatted time as well as the numerical time, meaning we can display it and do mathematical operations on it
      times: times,
      timeCount: timeCount,
      averageMinutes: 0,
      meanTime: '',
      medianTime: '',
      stdDevMinutes: 0,
      stdDevTime: '',
      minTimeMinutes: 0,
      minTime: '',
      maxTimeMinutes: 0,
      maxTime: ''
    };

    for (let time of times) {
      timesObject.averageMinutes += parseInt(time.split(':')[0]) * 60;
      timesObject.averageMinutes += parseInt(time.split(':')[1]);
    }

    timesObject.averageMinutes /= times.length;

    timesObject.meanTime = `${Math.floor(timesObject.averageMinutes / 60)}:${Math.round(timesObject.averageMinutes % 60)}`;

    if (timesObject.meanTime.split(':')[1].length < 2) {
      timesObject.meanTime = `${timesObject.meanTime}0`;
    }

    if (times.length%2 == 1) {
      timesObject.medianTime = times[(times.length - 1) / 2];

    } else {
      timesObject.medianTime = `${Math.floor((parseInt(times[((times.length)/2) - 1].split(':')[0]) + parseInt(times[((times.length)/2)].split(':')[0]))/2)}:${Math.round((parseInt(times[((times.length)/2) - 1].split(':')[1]) + parseInt(times[((times.length)/2)].split(':')[1]))/2)}`
    }

    if (timesObject.medianTime.split(':')[1].length < 2) {
      timesObject.medianTime = `${timesObject.medianTime}0`;
    }

    let timeInMinutes;

    for (let time of times) {
      timeInMinutes = parseInt((time.split(':')[0]) * 60) + parseInt(time.split(':')[1]);
      timesObject.stdDevMinutes += (Math.pow((timeInMinutes - timesObject.averageMinutes), 2));
    }

    timesObject.stdDevMinutes = Math.sqrt(timesObject.stdDevMinutes / times.length);
    timesObject.stdDevTime = `${Math.floor(timesObject.stdDevMinutes / 60)}:${Math.round(timesObject.stdDevMinutes % 60)}`;

    if (timesObject.stdDevTime.split(':')[1].length < 2) {
      timesObject.stdDevTime = `${timesObject.stdDevTime}0`;
    }

    timesObject.minTimeMinutes = timesObject.averageMinutes - timesObject.stdDevMinutes;
    timesObject.maxTimeMinutes = timesObject.averageMinutes + timesObject.stdDevMinutes;

    timesObject.minTime = `${Math.floor(timesObject.minTimeMinutes/60)}:${Math.round(timesObject.minTimeMinutes%60)}`;
    timesObject.maxTime = `${Math.floor(timesObject.maxTimeMinutes/60)}:${Math.round(timesObject.maxTimeMinutes%60)}`;

    if (timesObject.minTime.split(':')[1].length < 2) {
      timesObject.minTime = `${timesObject.minTime}0`;
    }

    if (timesObject.maxTime.split(':')[1].length < 2) {
      timesObject.maxTime = `${timesObject.maxTime}0`;
    }


    res.render('cafe/data', {items, popularCustomers, longestOrderCustomers, lucrativeCustomers, popularItems, orderedQuantities, pricepoints, combinations: populatedCombinations, times: timesObject});

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.get('/order/new', middleware.isLoggedIn, middleware.cafeOpen, (req, res) => { //RESTFUL routing 'order/new' route

  (async() => {

    const sent_orders = await Order.find({name: `${req.user.firstName} ${req.user.lastName}`, present: true}); //Find all of this user's orders that are currently active

    if (!sent_orders) {
      req.flash('error', "Unable to find orders");
      return res.redirect('back');

    } else if (sent_orders.length > 2) {
      req.flash('error', "You have made the maximum number of orders for the day");
      return res.redirect('back');
    }

    const types = await Type.find({}).populate('items');

    if (!types) {
      req.flash('error', "Unable to find categories");
      return res.redirect('back');
    }

    res.render('cafe/newOrder', {types});

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.post('/order', middleware.isLoggedIn, middleware.cafeOpen, (req, res) => { //RESTful routing 'order/create'

  (async () => { //Asynchronous function controls user ordering

    const sent_orders = await Order.find({name: `${req.user.firstName} ${req.user.lastName}`, present: true}); //Find all of this user's orders that are currently active

    if (!sent_orders) {
      req.flash('error', "Unable to find orders");return res.redirect('back');

    } else if (sent_orders.length > 2) { //If more than two orders are already made, you cannot order again
      req.flash('error', "You have made the maximum number of orders for the day"); return res.redirect('back');
    }

    if (req.body.check) { //If any items are selected

      const foundItems = await Item.find({}); //Find all items
      let orderCharge = 0; //Track to compare w/ balance

      if (!foundItems) {
        req.flash('error', 'No items found'); return res.redirect('back');
      }

      let unavailable = false; //The unavailable variable will determine if any items are unavailable in the quantities that the user requests (for an unlikely scenario where someone orders WHILE the user is ordering)

      for (let i = 0; i < foundItems.length; i ++) { //Iterate through each item and check if it has less available then the user's order
        if (Object.keys(req.body.check).includes(foundItems[i]._id.toString())) { //If item is selected to be ordered

          if (foundItems[i].availableItems < parseInt(req.body[foundItems[i].name])) { //First test to see if all items are available
            unavailable = true;
            break;

          } else { //If all items are available, perform these operations
            foundItems[i].availableItems -= parseInt(req.body[foundItems[i].name]);
            orderCharge += (foundItems[i].price * parseInt(req.body[foundItems[i].name])); //Increment charge

            if (foundItems[i].availableItems == 0) {
              foundItems[i].isAvailable = false;
            }

            await foundItems[i].save(); //If we find that the item has lost orders out now, change the item's status

          }
        }
      }

      if (orderCharge > req.user.balance) { //Check to see if you are ordering more than you can
        req.flash("error", "You do not have enough money in your account to pay for this order. Contact the principal to update your balance.");
        res.redirect('/cafe');

      } else if (unavailable) { //This should not be necessary for the most part, since if an item is unavailable, it doesn't show up in the menu. But if the user starts ordering before someone else submits their order, this is a possibility
        req.flash("error", "Some items are unavailable in the quantities you requested. Please order again.");
        res.redirect('/cafe/order/new');

      } else {
        req.flash("success", "Order Sent!");
        res.redirect('/cafe');
      }

    } else { //If no items were checked
      req.flash('error', "Cannot send empty order");
      res.redirect('/cafe/order/new');
    }

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});


router.get('/orders', middleware.isLoggedIn, middleware.isMod, (req, res) => { //This is for EC Cafe Workers to check all the available orders
  Order.find({present: true})
  .populate('items.item').exec((err, foundOrders) => { //Collect all orders which are currently active, and get all info on their items
    if (err) {
      req.flash('error', 'Could not find orders');
      console.log(err);
      res.redirect('back');

    } else {
      res.render('cafe/orderDisplay', {orders: foundOrders});
    }
  });
});

router.delete('/order/:id', middleware.isLoggedIn, middleware.cafeOpen, (req, res) => { //RESTful routing 'order/destroy' (for users to delete an order they no longer want)

  Order.findByIdAndDelete(req.params.id).populate('items.item').exec((err, foundOrder) => { //Delete the item selected in the form (but first, collect info on its items so you can replace them)
    if (err || !foundOrder) {
      req.flash("error", "Unable to access database");
      res.redirect('back');

    } else {
      for (let i = 0; i < foundOrder.items.length; i += 1) { //For each of the order's items, add the number ordered back to that item. (If there are 12 available quesadillas and the  user ordered 3, there are now 15)
        foundOrder.items[i].item.availableItems += foundOrder.items[i].quantity;
        foundOrder.items[i].item.isAvailable = true;
        foundOrder.items[i].item.save();
      }

      req.flash('success', "Order canceled!");
      res.redirect('/cafe');
    }
  });
});

router.post('/:id/ready', middleware.isLoggedIn, middleware.isMod, (req, res) => {

  (async () => {
    const order = await Order.findById(req.params.id).populate('items.item').populate('customer'); //Find the order that is currently being handled based on id, and populate info about its items
    if (!order) {
      req.flash('error', 'Could not find order'); return res.redirect('/cafe/orders');
    }

    order.present = false; //Order is not active anymore
    await order.save();

    const cafes = await Cafe.find({});
    if (!cafes) {
      req.flash('error', "Unable to find cafe info");
      return res.redirect('back');
    }

    cafes[0].revenue += order.charge;
    cafes[0].save();

    order.customer.debt += order.charge; //Update customer money info
    order.customer.balance -= order.charge;
    order.customer.save();

    const notif = await Notification.create({subject: "Cafe Order Ready", sender: req.user, recipients: [order.customer], read: [], toEveryone: false, images: []}); //Create a notification to alert the user
      if (!notif) {
        req.flash('error', 'Unable to send notification'); return res.redirect('/cafe/orders');
      }

      notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");

      let itemText = []; //This will have all the decoded info about the order
      for (var i = 0; i < order.items.length; i++) {
        itemText.push(` - ${order.items[i].item.name}: ${order.items[i].quantity} order(s)`);
      }

      //Render the item's charge in '$dd.cc' pattern, based on what the actual charge is
      if (!order.charge.toString().includes('.')) {
        notif.text = "Your order is ready to pick up:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + ".00";

      } else if (order.charge.toString().split('.')[1].length == 1){
        notif.text = "Your order is ready to pick up:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "0";

      } else {
        notif.text = "Your order is ready to pick up:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "";
      }

      await notif.save();

      let orderEmail = {
  		  from: 'noreply.saberchat@gmail.com',
  		  to: order.customer.email,
  		  subject: 'Cafe Order Ready',
  			text: `Hello ${order.customer.firstName},\n\n${notif.text}\n\n`
  		};

  		transporter.sendMail(orderEmail, function(error, info){
  		  if (error) {
  		    console.log(error);
  		  } else {
  		    console.log('Email sent: ' + info.response);
  		  }
  		});

      order.customer.inbox.push(notif); //Add notif to user's inbox
      order.customer.msgCount += 1;
      await order.customer.save();

      req.flash('success', 'Order ready! A notification has been sent to the customer. If they do not arrive within 5 minutes, try contacting them again.');
      res.redirect('/cafe/orders');

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.post('/:id/reject', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  (async() => {
    const order = await Order.findById(req.params.id).populate('items.item').populate('customer');

    if (!order) {
      req.flash('error', 'Could not find order'); return res.redirect('back');
    }

    const deletedOrder = await Order.findByIdAndDelete(order._id).populate('items.item').populate('customer');

    if (!deletedOrder) {
      req.flash('error', "Unable to delete order"); return res.redirect('back');
    }

    for (let i of order.items) { //Iterate over each item/quantity object
      i.item.availableItems += i.quantity;
      i.item.isAvailable = true;
      await i.item.save();
    }

    const notif = await Notification.create({subject: "Cafe Order Rejected", sender: req.user, recipients: [order.customer], read: [], toEveryone: false, images: []}); //Create a notification to alert the user
    if (!notif) {
      req.flash('error', 'Unable to send notification'); return res.redirect('/cafe/orders');
    }

    notif.date = dateFormat(notif.created_at, "h:MM TT | mmm d");

    let itemText = []; //This will have all the decoded info about the order
    for (var i = 0; i < order.items.length; i++) {
      itemText.push(` - ${order.items[i].item.name}: ${order.items[i].quantity} order(s)`);
    }

    //Render the item's charge in '$dd.cc' pattern, based on what the actual charge is
    if (!order.charge.toString().includes('.')) {
      notif.text = "Your order was rejected. This is most likely because we suspect your order is not genuine. Contact us if you think there has been a mistake.\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + ".00";

    } else if (order.charge.toString().split('.')[1].length == 1){
      notif.text = "Your order was rejected. This is most likely because we suspect your order is not genuine. Contact us if you think there has been a mistake.\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "0";

    } else {
      notif.text = "Your order was rejected. This is most likely because we suspect your order is not genuine. Contact us if you think there has been a mistake.\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "";
    }

    await notif.save();

    let orderEmail = {
      from: 'noreply.saberchat@gmail.com',
      to: order.customer.email,
      subject: 'Cafe Order Rejected',
      text: `Hello ${order.customer.firstName},\n\n${notif.text}\n\n`
    };

    transporter.sendMail(orderEmail, function(error, info){
      if (error) {
        console.log(error);
      } else {
        console.log('Email sent: ' + info.response);
      }
    });

    order.customer.inbox.push(notif); //Add notif to user's inbox
    order.customer.msgCount += 1;
    await order.customer.save();

    req.flash('success', 'Order rejected! A message has been sent to the customer.');
    res.redirect('/cafe/orders');

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.get('/manage', middleware.isLoggedIn, middleware.isMod, (req, res) => { //Route to manage cafe
  Type.find({}).populate('items').exec((err, foundTypes) => { //Collect info on all the item types
    if (err || !foundTypes) {
      req.flash('error', 'Unable to access Database');
      res.redirect('/cafe');

    } else {
      Cafe.find({}, (err, foundCafe) => { //Collect info on whether or not the cafe is open
        if (err || !foundCafe) {
          req.flash('error', "Unable to access database");
          res.redirect('back');

        } else {
          res.render('cafe/manage', {types: foundTypes, open: foundCafe[0].open});
        }
      });
    }
  });
});

router.get('/open', middleware.isLoggedIn, middleware.isMod, (req, res) => { //Route to open cafe
  Cafe.find({}, (err, foundCafe) => {
    if (err || !foundCafe) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else {
      //Open cafe here
      foundCafe[0].open = true;
      foundCafe[0].save();
      req.flash('success', "Cafe is now open!");
      res.redirect('/cafe/manage');
    }
  });
});

router.get('/close', middleware.isLoggedIn, middleware.isMod, (req, res) => { //Route to close cafe
  Cafe.find({}, (err, foundCafe) => {
    if (err || !foundCafe) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else {
      //Close cafe here
      foundCafe[0].open = false;
      foundCafe[0].save();
      req.flash('success', "Cafe is now closed!");
      res.redirect('/cafe/manage');
    }
  });
});

router.get('/item/new', middleware.isLoggedIn, middleware.isMod, (req, res) => { //RESTFUL routing 'item/new'
  Type.find({}, (err, foundTypes) => { //Find all possible item types
    if (err || !foundTypes) {
      req.flash('error', "Unable to access database");

    } else {
      res.render('cafe/newOrderItem', {types: foundTypes});
    }
  });
});

router.post('/item', middleware.isLoggedIn, middleware.isMod, (req, res) => { //RESTFUL routing 'item/create'

  (async() => {

    const overlap = await Item.find({name: req.body.name});

    if (!overlap) {
      req.flash('error', "Unable to find items");return res.redirect('back');

    } else if (overlap.length > 0) {
      req.flash('error', "Item already in database");return res.redirect('back');
    }

    const item = await Item.create({name: req.body.name, availableItems: parseInt(req.body.available), description: req.body.description, imgUrl: req.body.image}); //Create the item

    if (!item) {
      req.flash('error', "Unable to create item");return res.redirect('back');
    }

    //Algorithm to create charge; once created, add to item's info

    if (parseFloat(req.body.price)) {
      item.price = parseFloat(req.body.price);

    } else {
      item.price = 0.00;
    }

    //Determine is type is available based on whether or not the EC admin made its availability more than 0
    if (parseInt(req.body.available) > 0) {
      item.isAvailable = true;
    }

    const type = await Type.findOne({name: req.body.type}); //Find the type specified in the form

    if (!type) {
      req.flash('error', "Unable to find correct item type");return res.redirect('back');
    }

    await item.save();
    type.items.push(item); //Push this item to that type's item list
    await type.save();
    res.redirect('/cafe/manage');

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.get('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { //View an item's profile

  (async() => {

    const item = await Item.findById(req.params.id); //Find item based on specified id

    if (!item) {
      req.flash('error', "Unable to find item"); return res.redirect('back')
    }

    const types = await Type.find({}); //Find all types
    if (!types) {
      req.flash('error', "Unable to find item categories"); return res.redirect('back');
    }

    res.render('cafe/show.ejs', {types, item});

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.put('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { //Update an item

  (async() => {

    const item = await Item.findByIdAndUpdate(req.params.id, { //Find item based on specified ID
      //Update all of these properties
      name: req.body.name,
      price: parseFloat(req.body.price),
      availableItems: parseInt(req.body.available),
      isAvailable: (parseInt(req.body.available) > 0),
      description: req.body.description,
      imgUrl: req.body.image
    });

    if (!item) {
      req.flash('error', 'item not found'); return res.redirect('back');
    }

    const activeOrders = await Order.find({present:true}).populate('items.item'); //Any orders that are active will need to change, to accomodate the item changes.

    if (!activeOrders) {
      req.flash('error', "Unable to find active orders"); return res.redirect('back');
    }

    for (let order of activeOrders) {
      order.charge = 0; //Reset the order's charge, we will have to recalculate

      for (let i = 0; i < order.items.length; i += 1) { //Iterate over each order, and change its price to match the new item prices
        order.charge += order.items[i].item.price * order.items[i].quantity;
        order.items[i].price = item.price;
      }

      await order.save();
    }

    const types = await Type.find({name: {$ne: req.body.type}}); //Collect all item types

    if (!types) {
      req.flash('error', "Unable to find item categories"); return res.redirect('back');
    }

    for (let t of types) { //Remove this item from its old item type (if the type has not changed, it's fine because we' add it back in a moment anyway)
      if (t.items.includes(item._id)) {
        t.items.splice(t.items.indexOf(item._id), 1);
      }

      await t.save();
    }

    const type = await Type.findOne({name: req.body.type});  //Add the item to the type which is now specified

    if (!type) {
      req.flash('error', 'Unable to find item category');
    }

    if (type.items.includes(item._id)) { //If item is already in type, remove it so you can put the updated type back (we don't know whether the type will be there or not, so it's better to just cover all bases)
      type.items.splice(type.items.indexOf(item._id), 1);
    }

    type.items.push(item);
    await type.save();

    req.flash('success', "Item updated!");
    res.redirect('/cafe/manage');

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.delete('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { //Delete order item

  (async() => {

    const item = await Item.findByIdAndDelete(req.params.id); //Delete item based on specified ID

    if (!item) {
      req.flash('error', 'Could not delete item'); return res.redirect('back');
    }

    const types = await Type.find({}); //Find all possible types

    if (!types) {
      req.flash('error', "Could not remove item from list of item categories"); return res.redirect('back');
    }

    for (let type of types) { //If the type includes this item, remove the item from that type's item list
      if (type.items.includes(item._id)) {
        type.items.splice(type.items.indexOf(item._id), 1);
        await type.save();
      }
    }

    const orders = await Order.find({}).populate('items.item');

    if (!orders) {
      req.flash('error', 'Could not find orders'); return res.redirect('back');
    }

    for (let order of orders) {//If the order includes this item, remove the item from that order's item list
      for (let i of order.items) {
        if (i.item == null) {
          order.items.splice(i, 1);
        }
      }

      order.charge = 0;
      for (let i of order.items) {
        order.charge += (i.item.price * i.quantity);
      }

      order.save();
    }

    req.flash('success', 'Deleted Item!');
    res.redirect('/cafe/manage');

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.get('/type/new', middleware.isLoggedIn, middleware.isMod, (req, res) => { // RESTful route "New" for type
  Type.find({}).populate('items').exec((err, types) => { //Collect info on all the items, so that we can give the user the option to add them to that type
    if (err || !types) {
      req.flash('error', "Unable to find categories");
      res.redirect('back');

    } else {
      res.render('cafe/newItemType', {types});
    }
  });
});

router.post('/type', middleware.isLoggedIn, middleware.isMod, (req, res) => { // RESTful route "Create" for type

  ( async() => {

    const overlappingTypes = await Type.find({name: req.body.name}); //Find all item types with this name that already exist

    if (!overlappingTypes) {
      req.flash('error', "Unable to find item categories"); return res.redirect('back');
    }

    if (overlappingTypes.length == 0) { //If there are none, go ahead
      const type = await Type.create({name: req.body.name, items: []});

      if (!type) {
        req.flash('error', "Item Category could not be created"); return res.redirect('back');
      }

      const types = await Type.find({}); //Found types, but represents all item types
      if (!types) {
        req.flash('error', "Could not find item categories"); return res.redirect('back');
      }

      for (let t of types) { //Now that we've created the type, we have to remove the newly selected items from all other types
        for (let i = 0; i < t.items.length; i += 1) {
          if(req.body[t.items[i].toString()]) {
            t.items.splice(i, 1);
          }
        }

        await t.save();
      }

      const items = await Item.find({}); //Find all items

      if (!items) {
        req.flash('error', 'Could not find items'); return res.redirect('back');
      }

      for (let item of items) { //If the item is selected, add it to this type (now that we've removed it from all other types)
        if(req.body[item._id.toString()]) {
          type.items.push(item);
        }
      }

      await type.save();

      req.flash('success', "Item Category Created!");
      res.redirect('/cafe/manage');

    } else { //If an overlap is found
      req.flash('error', "Item category already in database.");
      res.redirect('back');
    }

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.get('/type/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { // RESTful route "Show/Edit" for type

  (async() => {

    const type = await Type.findById(req.params.id).populate('items'); //Find the specified type

    if (!type) {
      req.flash('error', "Unable to access database"); return res.redirect('back');

    } else if (type.name == "Other") {
      req.flash('error', "You cannot modify that category"); return res.redirect('/cafe/manage');
    }

    const types = await Type.find({_id: {$nin: type._id}}).populate('items'); //Find all items

    if (!types) {
      req.flash('error', "Unable to access database"); return res.redirect('back');
    }

    res.render('cafe/editItemType', {type, types});

  })().catch(err => {
    console.log(err);
    req.flash('error', "Unable to access database");
    res.redirect('back');
  });
});

router.put('/type/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { // RESTful route "Update" for type

  (async() => {

    const types = await Type.find({_id: {$ne: req.params.id}, name: req.body.name}); //Find all types besides the one we are editing with the same name

    if (!types) {
      req.flash('error', "Unable to access database"); return res.redirect('back');
    }

    if (types.length == 0) { //If no items overlap, then go ahead

      const type = await Type.findByIdAndUpdate(req.params.id, {name: req.body.name}); //Update this item type based on the id

      if (!type) {
        req.flash('error', "Unable to update item category"); return res.redirect('back');
      }

      //Problem here
      const ft = await Type.find({_id: {$ne: type._id}}); //Find all other types

      if (!ft) {
        req.flash('error', "Unable to find item categories"); return res.redirect('back');
      }

      let deletes = []; //Which items to remove from type

      for (let t of ft) { //Iterate over other types

        deletes = [];

        for (let i = 0; i < t.items.length; i += 1) { //Update them to remove the newly selected items from their 'items' array
          if(req.body[t.items[i].toString()]) {
            deletes.push(i);
          }
        }

        for (let index of deletes.reverse()) { //Reverse so that indices remain same
          t.items.splice(index, 1);
        }

        await t.save();
      }

      //Ends here

      const foundItems = await Item.find({}); //Find all items

      if (!foundItems) {
        req.flash('error', 'Unable to find items'); return res.redirect('back');
      }

      for (let item of type.items) {
        if (!req.body[item._id.toString()]) { //Item is no longer checked

          const other = await Type.findOne({name: 'Other'}); //Find type 'other'

          if (!other) {
            req.flash('error', "Unable to find item category 'Other', please add it'"); res.redirect('back'); //There's nowhere for the type-less items to go unless 'Other' exists
          }

          other.items.push(item); //Move that item to 'Other'
          await other.save();

        }
      }

      type.items = []; //type is now empty

      for (let item of foundItems) { //Push new items to type's items[] array, based on the latest changes
        if(req.body[item._id.toString()]) {
          type.items.push(item);
        }
      }

      await type.save();

      req.flash('success', "Item category updated!");
      res.redirect('/cafe/manage');

    } else {
      req.flash('error', "Item category already in database");
      res.redirect('back');
    }

  })().catch(err => {
    console.log(err)
    req.flash('error', "Unable to access database")
    res.redirect('back')
  });
});

router.delete('/type/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => { //// RESTful route "Destroy" for type

  (async() => {

    const type = await Type.findByIdAndDelete(req.params.id); //Delete type based on specified ID

    if (!type) {
      req.flash('error', "Unable to find item category"); return res.redirect('back');
    }

    const other = await Type.findOne({name: "Other"}); //Find the type with name 'Other' - we've created this type so that any unselected items go here

      if (!other) {
        req.flash('error', "Unable to find item category 'Other', please add it"); return res.redirect('back');
      }

      for (let item of type.items) {
        other.items.push(item);
      }

      await other.save();

    req.flash('success', "Item category deleted!");
    res.redirect('/cafe/manage');

  })().catch(err => {
    console.log(err)
    req.flash('error', "Unable to access database")
    res.redirect('back')
  });
});

module.exports = router;
