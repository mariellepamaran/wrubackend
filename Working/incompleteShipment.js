const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.incompleteShipment = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        function getTimestamp(date){
            date = date || new Date();
            return moment(date).valueOf();
        }

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                  "coket1":null,
                  "wilcon":null,
            },
            process = function(clientName){
                const db = client.db(`wd-${clientName}`),
                      dispatchCollection = db.collection('dispatch');

                dispatchCollection.aggregate([
                    {
                        $match: { status: "in_transit" }
                    },
                    { 
                        $lookup: {
                            from: 'routes',
                            localField: 'route',
                            foreignField: '_id',
                            as: 'route',
                        }
                    },
                    { $unwind: "$route" }, // do not preserveNull. Route is required for transit_time
                ]).toArray().then(docs => {
                    var _ids = [];
                    docs.forEach(val => {
                        val.route = val.route || {}; // because of $unwind
                        val.event_time = val.event_time || {};
                        val.destination = val.destination || [];
                        if(val.event_time.in_transit && val.route) {
                            var transitDH = (((getTimestamp() - getTimestamp(new Date(val.event_time.in_transit)))/3600)/1000);
                            var leeway = Number(val.route.transit_time) + 12;
                            console.log("_id",val._id,"transitDH",transitDH,"leeway",leeway);
                            if(transitDH > leeway){
                                _ids.push(val._id);
                            }
                        }
                    });
                    console.log("_ids",JSON.stringify(_ids));
        
                    if(_ids.length > 0){
                        var set = {status: "incomplete"};
                        set[`event_time.incomplete`] = moment(new Date()).toISOString();
                        set[`history.${moment(new Date()).valueOf()}`] = `System - Status updated to 'incomplete'.`;
                        dispatchCollection.updateMany({_id: {$in: _ids}}, {$set: set}).then(() => {
                            areClientsDone(clientName);
                        }).catch(error => {
                            client.close();
                            console.log('Error: ' + JSON.stringify(error));
                            res.status(500).send('Error: ' + JSON.stringify(error));
                        });
                    } else {
                        areClientsDone(clientName);
                    }
                }).catch(error => {
                    console.log('Error: ' + JSON.stringify(error));
                    res.status(500).send('Error: ' + JSON.stringify(error));
                });
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                if(done === true){
                    client.close();
                    res.status(200).send("OK");
                }
            };

        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};