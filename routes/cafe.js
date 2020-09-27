const express = require('express');
const middleware = require('../middleware');
const router = express.Router();
const dateFormat = require('dateformat');

const User = require('../models/user');
const Order = require('../models/order');
const Item = require('../models/orderItem');
const Notification = require('../models/notification');
const Type = require('../models/itemType');
const Cafe = require('../models/cafe')

router.get('/', middleware.isLoggedIn, (req, res) => {
  Order.find({customer: req.user._id})
  .populate('items').exec((err, foundOrders) => {

    if (err || !foundOrders) {

      req.flash('error', "Could not find your orders");
      console.log(err);
      res.redirect('back');

    } else {
      res.render('cafe/index', {orders: foundOrders});
    }
  });
});

router.get('/menu', middleware.isLoggedIn, (req, res) => {
  Type.find({}).populate('items').exec((err, foundTypes) => {
    if (err || !foundTypes) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {
      res.render('cafe/menu', {types: foundTypes})
    }
  })
})

router.get('/order/new', [middleware.isLoggedIn, middleware.cafeOpen], (req, res) => {

  Type.find({}).populate('items').exec((err, foundTypes) => {
    if (err || !foundTypes) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {
      res.render('cafe/newOrder', {types: foundTypes});
    }
  })
});

router.post('/order', [middleware.isLoggedIn, middleware.cafeOpen], (req, res) => {

  Order.find({name: `${req.user.firstName} ${req.user.lastName}`, present: true}, (err, foundOrders) => {
    if (err || !foundOrders) {
      req.flash("error", "Unable to access database")
      res.redirect('back')

    } else {
      if (foundOrders.length >= 3) {
        req.flash("error", "You have made the maximum number of orders for one day")
        res.redirect('back')

      } else {
        if (req.body.check) {

          Item.find({}, (err, foundItems) => {

            let unavailable = false

            if (err || !foundItems) {
              req.flash('error', "Unable to access database")
              res.redirect('back')

            } else {
              for (let i = 0; i < foundItems.length; i ++) {
                if (Object.keys(req.body.check).includes(foundItems[i]._id.toString())) { //If item is selected to be ordered

                  if (foundItems[i].availableItems < parseInt(req.body[foundItems[i].name])) { //First test to see if all items are available
                    unavailable = true
                    break //Immediately quit

                  } else { //If all items are available, perform these operations
                    foundItems[i].availableItems -= parseInt(req.body[foundItems[i].name])

                    if (foundItems[i].availableItems == 0) {
                      foundItems[i].isAvailable = false;
                    }

                    foundItems[i].save()

                  }
                }
              }
            }

            if (!unavailable) {
              req.flash("success", "Order Sent!")
              res.redirect('/cafe');

            } else {
              req.flash("error", "Some items are unavailable in the quantities you requested")
              res.redirect('/cafe/new');
            }
          })

        } else {
          req.flash('error', "Cannot send empty order")
          res.redirect('/cafe/new');
        }
      }
    }
  })
});

router.get('/orders', middleware.isLoggedIn, (req, res) => {
  Order.find({present: true})
  .populate('items').exec((err, foundOrders) => {
    if (err) {
      req.flash('error', 'Could not find orders');
      console.log(err)
      res.redirect('back');

    } else {
      res.render('cafe/orderDisplay', {orders: foundOrders})
    }
  });
});

router.delete('/order/:id', [middleware.isLoggedIn, middleware.cafeOpen], (req, res) => {

  Order.findByIdAndDelete(req.params.id).populate('items').exec((err, foundOrder) => {
    if (err || !foundOrder) {
      req.flash("error", "Unable to access database")
      res.redirect('back')

    } else {
      for (let i = 0; i < foundOrder.items.length; i += 1) {
        foundOrder.items[i].availableItems += foundOrder.quantities[i]
        foundOrder.items[i].isAvailable = true;
        foundOrder.items[i].save()
      }

      req.flash('success', "Order deleted!")
      res.redirect('/cafe')
    }
  })
})

router.post('/:id/ready', middleware.isLoggedIn, (req, res) => {

  (async () => {
    const order = await Order.findById(req.params.id).populate('items').populate('customer');
    if (!order) {
      req.flash('error', 'Could not find order'); return res.redirect('/cafe/orders');

    } else {

      order.present = false;
      order.save()

      Notification.create({subject: "Cafe Order Ready", sender: req.user, recipients: [order.customer], read: [false], toEveryone: false, images: []}, (err, notif) => {
        if (err) {
          req.flash('error', "Could not create notif");
          console.log(err);
          res.redirect('/cafe/orders');

        } else {

          notif.date = dateFormat(notif.created_at, "mmm d, h:MMTT");

          let itemText = [];
          for (var i = 0; i < order.items.length; i++) {
            itemText.push(` - ${order.items[i].name}: ${order.quantities[i]} order(s)`);
          }

          if (!order.charge.toString().includes('.')) {
            notif.text = "Your order is ready:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + ".00";

          } else if (order.charge.toString().split('.')[1].length == 1){
            notif.text = "Your order is ready:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "0";

          } else {
            notif.text = "Your order is ready:\n" + itemText.join("\n") + "\n\nExtra Instructions: " + order.instructions + "\nTotal Cost: $" + order.charge + "";
          }

          notif.save();
          order.customer.inbox.push(notif);
          order.customer.notifCount += 1
          order.customer.save();

          res.redirect('/cafe/orders');
        }
      });
    }

  })().catch(err => {
    console.log(err)
    req.flash('error', "Unable to access database")
    res.redirect('back')
  })
});

router.get('/manage', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Type.find({}).populate('items').exec((err, foundTypes) => {
    if (err || !foundTypes) {
      req.flash('error', 'Cannot access Database');
      res.redirect('/cafe');

    } else {
      Cafe.find({}, (err, foundCafe) => {
        if (err || !foundCafe) {
          req.flash('error', "Unable to access database");
          res.redirect('back');

        } else {
          res.render('cafe/manage', {types: foundTypes, open: foundCafe[0].open})
        }
      })
    }
  })
});

router.get('/open', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Cafe.find({}, (err, foundCafe) => {
    if (err || !foundCafe) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else {
      foundCafe[0].open = true;
      foundCafe[0].save();
      req.flash('success', "Cafe is now open!")
      res.redirect('/cafe/manage')
    }
  })
})

router.get('/close', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Cafe.find({}, (err, foundCafe) => {
    if (err || !foundCafe) {
      req.flash('error', "Unable to access database");
      res.redirect('back');

    } else {
      foundCafe[0].open = false;
      foundCafe[0].save();
      req.flash('success', "Cafe is now closed!")
      res.redirect('/cafe/manage')
    }
  })
})

router.get('/item/new', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Type.find({}, (err, foundTypes) => {
    if (err || !foundTypes) {
      req.flash('error', "Unable to access database")

    } else {
      res.render('cafe/newOrderItem', {types: foundTypes})
    }
  })
});

router.post('/item', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Item.create({}, (err, item) => {
    if (err) {
      console.log(err);
      req.flash('error', 'item could not be created');
      res.redirect('/cafe/newOrderItem');

    } else {
      item.name = req.body.name;
      item.availableItems = parseInt(req.body.available)
      item.description = req.body.description;
      item.imgUrl = req.body.image

      if (parseFloat(req.body.price)) {
        item.price = parseFloat(req.body.price);
      } else {
        item.price = 0.00;
      }
      item.isAvailable = true;


      Type.findOne({name: req.body.type}, (err, foundType) => { //Access type
        if (err || !foundType) {
          req.flash('error', "Unable to access database")

        } else {
          item.save()
          foundType.items.push(item);
          foundType.save();
          console.log('New OrderItem created: '.cyan);
          console.log(item);
          res.redirect('/cafe/manage');
        }
      })
    }
  });
});

// NOT BEING USED
// router.get('/deleteItems', middleware.isLoggedIn, middleware.isMod, (req, res) => {
//   res.render('cafe/deleteitems')
// });
//
// router.delete('/deleteItems', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  // Checkboxes
// });

router.get('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Item.findOne({_id: req.params.id}, (err, foundItem) => {
    if (err || !foundItem) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {
      Type.find({}, (err, foundTypes) => {
        if (err || !foundTypes) {
          req.flash('error', "Unable to access database")

        } else {
          res.render('cafe/show.ejs', {types: foundTypes, item: foundItem})
        }
      });
    }
  })
});

router.put('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Item.findByIdAndUpdate(req.params.id, {
    name: req.body.name,
    price: parseFloat(req.body.price),
    availableItems: parseInt(req.body.available),
    isAvailable: (parseInt(req.body.available) > 0),
    description: req.body.description,
    imgUrl: req.body.image
  }, (err, foundItem) => {

    if (err || !foundItem) {
      req.flash('error', 'item not found');
      res.redirect('back')

    } else {

      Order.find({present:true}).populate('items').exec((err, foundOrders) => {
        if (err || !foundOrders) {
          req.flash('error', "Unable to access database")
          res.redirect('back')

        } else {

          for (let order of foundOrders) {
            order.charge = 0

            for (let i = 0; i < order.items.length; i += 1) {
              order.charge += order.items[i].price * order.quantities[i]
            }
            order.save()
          }
        }
      })

      Type.find({name: {$ne: req.body.type}}, (err, foundTypes) => {
        if (err || !foundTypes) {
          req.flash('error', "Unable to access database")
          res.redirect('back')

        } else {

          for (let type of foundTypes) {
            if (type.items.includes(foundItem._id)) {
              type.items.splice(type.items.indexOf(foundItem._id), 1)
            }

            type.save()
          }
        }
      })

      Type.findOne({name: req.body.type}, (err, foundType) => {
        if (foundType.items.includes(foundItem._id)) {
          foundType.items.splice(foundType.items.indexOf(foundItem._id), 1)
        }

        foundType.items.push(foundItem)
        foundType.save()
      })

      req.flash('success', "Item updated!")
      res.redirect('/cafe/manage');
    }
  })
});

router.delete('/item/:id', middleware.isLoggedIn, middleware.isMod, (req, res) => {
  Item.findByIdAndDelete(req.params.id, (err, item) => {
    if (err || !item) {
      req.flash('error', 'Could not delete item');
      res.redirect('back')

    } else {

      Type.find({}, (err, foundTypes) => {
        if (err || !foundTypes) {
          req.flash('error', "Could not delete item")
          res.redirect('back')

        } else {

          for (let type of foundTypes) {
            if (type.items.includes(item._id)) {
              type.items.splice(type.items.indexOf(item._id), 1);
              type.save();
            }
          }
        }
      })

      req.flash('success', 'Deleted item');
      res.redirect('/cafe/manage');
    }
  })
});

router.get('/type/new', [middleware.isLoggedIn, middleware.isMod], (req, res) => { // RESTful route "New" for type
  Item.find({}, (err,foundItems) => {
    if (err || !foundItems) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {
      res.render('cafe/newItemType', {items: foundItems})
    }
  })
})

router.post('/type', [middleware.isLoggedIn, middleware.isMod], (req, res) => { // RESTful route "Create" for type

  ( async() => {
    const foundTypes = await Type.find({name: req.body.name});

    if (!foundTypes) {
      req.flash('error', "Unable to find item types")
      res.redirect('back')

    } else if (foundTypes.length == 0) {
      Type.create({name: req.body.name, items: []}, (err, type) => {
        if (err) {
          console.log(err)
          req.flash('error', "Item Type could not be created")
          res.redirect('back')

        } else {

          (async() => {
            const ft = await Type.find({}); //Found types, but represents all item types
            if (!ft) {
              req.flash('error', "Could not find item types");
              res.redirect('back');

            } else {

              for (let t of ft) {
                for (let i = 0; i < t.items.length; i += 1) {
                  if(req.body[t.items[i].toString()]) {
                    t.items.splice(i, 1)
                  }
                }
                t.save()
              }

              (async() => {
                const foundItems = await Item.find({});
                if (!foundItems) {
                  req.flash('error', 'Could not find items')
                  res.redirect('back')

                } else {

                  for (let item of foundItems) {
                    console.log(req.body[item._id])
                    if(req.body[item._id.toString()]) {
                      console.log(item)
                      type.items.push(item)
                    }
                  }

                  type.save()
                }

              })().catch(err => {
                console.log(err)
                req.flash('error', "Unable to access database")
                res.redirect('back')
              })

              req.flash('success', "Item Category Created!")
              res.redirect('/cafe/manage')
            }

          })().catch(err => {
            console.log(err)
            req.flash('error', "Unable to access database")
            res.redirect('back')
          })
        }
      })

    } else {
      req.flash('error', "Item type already in database.")
      res.redirect('back')
    }

  })().catch(err => {
    console.log(err)
    req.flash('error', "Unable to access database")
    res.redirect('back')
  })
})

router.get('/type/:id', [middleware.isLoggedIn, middleware.isMod], (req, res) => { // RESTful route "Show/Edit" for type
  Type.findById(req.params.id, (err, type) => {
    if (err || !type) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {
      Item.find({}, (err, foundItems) => {
        if (err || !foundItems) {
          req.flash('error', "Unable to access database")
          res.redirect('back')

        } else {
          res.render('cafe/editItemType', {type, items: foundItems})
        }
      })
    }
  })
});

router.put('/type/:id', [middleware.isLoggedIn, middleware.isMod], (req, res) => { // RESTful route "Update" for type

  Type.find({_id: {$ne: req.params.id}, name: req.body.name}, (err, foundTypes) => {

    if (err || !foundTypes) {
      req.flash('error', "Unable to access database")

    } else if (foundTypes.length == 0) {

      Type.findByIdAndUpdate(req.params.id, {name: req.body.name}, (err, type) => {
        if (err || !type) {
          req.flash('error', "Unable to access database")
          res.redirect('back')

        } else {
          Type.find({_id: {$ne: type._id}}, (err, foundTypes) => {

            if (err || !foundTypes) {
              req.flash('error', "Unable to access database");
              res.redirect('back')

            } else {

              for (let type of foundTypes) {

                for (let i = 0; i < type.items.length; i += 1) {
                  if(req.body[type.items[i].toString()]) {
                    type.items.splice(i, 1)
                  }
                }

                type.save()
              }
            }
          })

          Item.find({}, (err, foundItems) => {

            if (err || !foundItems) {
              req.flash('error', "Unable to access database")
              res.redirect('back')

            } else {

              for (let item of type.items) {
                if (!req.body[item._id.toString()]) { //Item is no longer checked

                  Type.findOne({name: 'Other'}, (err, foundType) => {

                    if (err || !foundType) {
                      req.flash('error', "Unable to access database")
                      res.redirect('back')

                    } else {
                      foundType.items.push(item)
                      foundType.save()
                    }
                  })
                }
              }

              type.items = []

              for (let item of foundItems) {
                if(req.body[item._id.toString()]) {
                  type.items.push(item)
                }
              }

              type.save()
            }
          })

          req.flash('success', "Item type updated!")
          res.redirect('/cafe/manage')
        }
      })

    } else {
      req.flash('error', "Item already in database")
      res.redirect('back')
    }
  })

})

router.delete('/type/:id', [middleware.isLoggedIn, middleware.isMod], (req, res) => { //// RESTful route "Destroy" for type
  Type.findByIdAndDelete(req.params.id, (err, type) => {
    if (err || !type) {
      req.flash('error', "Unable to access database")
      res.redirect('back')

    } else {

      Type.findOne({name: "Other"}, (err, foundType) => {
        if (err || !foundType) {
          req.flash('error', "Unable to access database")

        } else {
          for (let item of type.items) {
            foundType.items.push(item)
          }
          foundType.save()
        }
      })

      req.flash('success', "Item type deleted!")
      res.redirect('/cafe/manage')
    }
  })
})

module.exports = router;
