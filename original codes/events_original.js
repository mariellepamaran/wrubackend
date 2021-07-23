const co = require('co');
const mongodb = require('mongodb');

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.events = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/");

        const client = yield mongodb.MongoClient.connect(uri),
              db = client.db('wd-coket1'),
              commandNotifierCollection = db.collection('command_notifier'),
              dispatchCollection = db.collection('dispatch');

        console.log("Method:",method);
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));

        if(method === "DELETE"){
            var _id = params_value[0];
            if(_id && _id.trim() === ""){
                res.status(400).send('Error: Missing parameters');
            } else {
                var docs = yield commandNotifierCollection.deleteOne({_id});
                client.close();
                res.status(200).send(docs);
            }
        } else {
            var GEOFENCE_NAME = query.GEOFENCE_NAME.split(" - ");
            dispatchCollection.find({
                "vehicle.username":query.USER_USERNAME, 
                $or: [ 
                        { "origin": {$regex : GEOFENCE_NAME[0]} }, 
                        { 
                            "destination": {
                                $elemMatch: {
                                    "location": {$regex : GEOFENCE_NAME[0]}
                                }
                            } 
                        } 
                    ],
                "status": {
                    $nin: ["plan","complete","incomplete"]
                }
            }).toArray().then(docs => {
                var _ids = {
                    in_transit: [],
                    queueing: [],
                    processing: [],
                    complete: []
                },
                dispatch = {};

                /** DECIMAL HOURS
                    Actual Time - Transit - In transit to Queueing
                    Actual Time - Queuing - Queueing to Processing
                    Actual Time - Processing - Processing to Complete
                */
                
                /****
                    Inside Geofence - Processing
                    Inside Geofence - Queueing
                    Outside Distribution Center
                    Outside Geofence - Processing
                
                    ✓ Saved entry -> PLAN
                    ✓ Outside Distribution Center -> IN TRANSIT
                    ✓ Inside Geofence - Queueing -> QUEUEING
                    ✓ Inside Geofence - Processing -> PROCESSING
                    ✓ Outside Geofence - Processing -> COMPLETE
                */
                
                if(docs.length > 0){
                    for(var i = 0; i < docs.length; i++){
                        var doc = docs[i],
                            isOrigin = (query.GEOFENCE_NAME.indexOf(doc.origin) > -1),
                            isDestination = (query.GEOFENCE_NAME.indexOf(doc.destination[0].location) > -1);
                        
                        if(query.RULE_NAME == "Inside Geofence" && ["dispatch"].includes(doc.status) && isOrigin === true && query.stage == "end"){
                            _ids.in_transit.push(doc._id);
                            dispatch[doc._id] = doc;
                        }
                        if(["Inside Geofence","Inside Geofence - Queueing"].includes(query.RULE_NAME) && doc.status == "in_transit" && isDestination === true && query.stage == "start"){
                            _ids.queueing.push(doc._id);
                        }
                        if(query.RULE_NAME == "Inside Geofence - Processing" && ["queueing","in_transit"].includes(doc.status) && isDestination === true && query.stage == "start"){
                            _ids.processing.push(doc._id);
                        }
                        if((query.RULE_NAME == "Inside Geofence - Processing" && doc.status == "processing" && isDestination === true && query.stage == "end") ||
                           (query.RULE_NAME == "Outside Geofence" && doc.status == "queueing" && isDestination === true && query.stage == "start")){
                            _ids.complete.push(doc._id);
                        }
                    }

                    var shipment_number = _ids.in_transit.concat(_ids.queueing).concat(_ids.processing).concat(_ids.complete);

                    if(shipment_number.length > 0){
                        console.log("shipment_number",shipment_number);
                        commandNotifierCollection.insertOne({
                            notification: JSON.stringify(query),
                            timestamp:new Date().toISOString(),
                            shipment_number
                        }).then(() => {
                            proceedToUpdate();
                        }).catch(error => {
                            console.log(JSON.stringify(error));
                            client.close();
                            res.status(500).send('Error in CN: ' + JSON.stringify(error));
                        });
                    } else {
                        proceedToUpdate();
                    }

                    function proceedToUpdate(){
                        var childPromise = [];
                        Object.keys(_ids).forEach(function(status) {
                            var date = new Date();

                            if(_ids[status].length > 0){
                                var set = { "status": status, };
                                set[`event_time.${status}`] = date.toISOString();
            
                                childPromise.push(dispatchCollection.updateMany({"_id": {$in: _ids[status]}}, { $set: set, $unset: {escalation1: "",escalation2: "",escalation3: ""}}));

                                if(status == "in_transit"){
                                    _ids[status].forEach(_id => {
                                        var obj = dispatch[_id],
                                            transit_time = HH_MM(obj.destination[0].transit_time),
                                            hours = transit_time.hour,
                                            minutes = transit_time.minute,
                                            newSet = {};
                                        newSet[`departure_date`] = date.toISOString();
                                        newSet[`destination.0.etd`] = date.toISOString();
                                        
                                        (hours)?date.setHours(date.getHours() + Number(hours)):null;
                                        (minutes)?date.setMinutes(date.getMinutes() + Number(minutes)):null;
                                        
                                        newSet[`destination.0.eta`] = date.toISOString();

                                        console.log(_id,newSet);

                                        childPromise.push(dispatchCollection.updateOne({ _id }, { $set: newSet }));
                                    });
                                }
                            } else {
                                console.log(`None [${status}]`);
                            }
                        });
                        if(childPromise.length > 0){
                            Promise.all(childPromise).then(data => {
                                console.log("Promise: ",JSON.stringify(data));
                                client.close();
                                res.status(200).send("OK");
                            }).catch(error => {
                                console.log("Failed to perform promise. Error: ",JSON.stringify(error));
                                client.close();
                                res.status(500).send(error);
                            });
                        } else {
                            console.log("Empty Promise");
                            client.close();
                            res.status(200).send("OK");
                        }
                    }
                    function HH_MM(dh,def){
                        def = def==null?"-":def;
                        var hour = "",
                            minute = "";
                        if(dh != null){
                            (dh != null) ? dh = Number(dh) : null;
                
                            dh = dh.toFixed(2);
            
                            hour = dh.toString().split(".")[0]; // convert decimal hour to HH:MM
                            minute = JSON.stringify(Math.round((dh % 1)*60)).split(".")[0];
                            if(hour.length < 2) hour = '0' + hour;
                            if(minute.length < 2) minute = '0' + minute;
                            def = `${hour}:${minute}`;
                        }
                        return {
                            hour,
                            minute,
                            hour_minute: def,
                        };
                    }
                } else {
                    client.close();
                    res.status(200).send("OK");
                }
            }).catch(error => {
                console.log(JSON.stringify(error));
                client.close();
                res.status(500).send('Error in find: ' + error);
            });            
        }
    }).catch(function(error) {
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};