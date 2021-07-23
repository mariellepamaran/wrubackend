const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.events = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/");

        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
              db = client.db('wd-coket1'),
              dbLogging = client.db('wd-coket1-logging'),
              eventsCollection = dbLogging.collection('events'),
              vehiclesCollection = db.collection('vehicles'),
              dispatchCollection = db.collection('dispatch');

        console.log("Method:",method," | DateTime: ",moment(new Date()).format("MM/DD/YYYY hh:mm:ss A"));
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));
        console.log("Filtered:",`${query.GEOFENCE_NAME} - ${query.USER_NAME} (${query.USER_USERNAME})`);

        if(method === "DELETE"){
            var _id = params_value[0];
            if(_id && _id.trim() === ""){
                res.status(400).send('Error: Missing parameters');
            } else {
                var docs = yield eventsCollection.deleteOne({_id});
                client.close();
                res.status(200).send(docs);
            }
        } else {
            var date = new Date(),
                insertedId = null,
                event = {
                    GEOFENCE_NAME: query.GEOFENCE_NAME,
                    RULE_NAME: query.RULE_NAME,
                    GEOFENCE_ID: query.GEOFENCE_ID,
                    stage: query.stage,
                    USER_NAME: query.USER_NAME,
                    USER_USERNAME: query.USER_USERNAME,
                    ASSIGNED_VEHICLE_ID: query.ASSIGNED_VEHICLE_ID,
                    Region: query.Region,
                    Cluster: query.Cluster,
                    Site: query.Site,
                    geofence_type: (query.GEOFENCE_NAME.indexOf(" PL") > -1) ? "PL" : "DC",
                    timestamp: moment(date).toISOString()
                },
                GEOFENCE_NAME = query.GEOFENCE_NAME.split(" - ");
            
            var tries = 0;
            function saveEventsLogs(){
                eventsCollection.insertOne(event).then(result => {
                    insertedId = result.insertedId;
                    console.log("insertedId",insertedId);
                }).catch(error => {
                    console.log("Error saving logs",JSON.stringify(error));
                    if(tries < 5){
                        tries++;
                        saveEventsLogs();
                    }
                });
            }
            saveEventsLogs();
            
            
            
            function saveVehicleLocation(callback){
                vehiclesCollection.find({_id: Number(query.ASSIGNED_VEHICLE_ID)}).toArray().then(vDocs => {
                    var vDoc = vDocs[0];
                    console.log("vDoc",JSON.stringify(vDoc));
                    try {
                        if(vDoc){
                            var location = vDoc.location || [],
                                short_name = GEOFENCE_NAME[0],
                                isPushed = false;
    
                            for(var i = location.length-1; i >= 0; i--){
                                // if location 1 is not null, check if same location.
                                // if same, add event under location 1
                                // if not same, 
                                    // create new location. 
                                    // add event to new location. 
                                    // transfer location 1 to location 0. 
                                    // new location will be location 1
                                if(location[i].short_name == short_name){
                                    location[i].events.push({RULE_NAME: query.RULE_NAME, stage: query.stage, timestamp: moment(date).toISOString()});
                                    isPushed = true;
                                    break;
                                } else {
                                    if(location.length == 5){
                                        location.splice(0,1);
                                    }
                                    location.push({
                                        short_name,
                                        events: [{RULE_NAME: query.RULE_NAME, stage: query.stage, timestamp: moment(date).toISOString()}]
                                    });
                                    isPushed = true;
                                    break;
                                }
                            }
                            if(!isPushed){
                                location.push({
                                    short_name,
                                    events: [{RULE_NAME: query.RULE_NAME, stage: query.stage, timestamp: moment(date).toISOString()}]
                                });
                            }
    
                            vehiclesCollection.updateOne({_id: Number(query.ASSIGNED_VEHICLE_ID)},{ $set: {location} }).then(docs => {
                                callback();
                            }).catch(error => {
                                console.log(error);
                                client.close();
                                res.status(500).send('Error in V: ' + JSON.stringify(error));
                            });
                        } else {
                            callback();
                        }
                    } catch(error){
                        console.log(error);
                        client.close();
                        res.status(500).send('Error in V: ' + error);
                    }
                }).catch(error => {
                    console.log(error);
                    client.close();
                    res.status(500).send('Error in V: ' + JSON.stringify(error));
                });
            }
            function getRandomInt(min, max) {
                min = Math.ceil(min);
                max = Math.floor(max);
                return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
            }

            setTimeout(function(){
                dispatchCollection.aggregate([
                    {
                        $match: {
                            status: {
                                $nin: ["plan","complete","incomplete"]
                            }
                        }
                    },
                    { $unwind: "$destination" },
                    { 
                        $lookup: {
                            from: 'vehicles',
                            let: { 
                                vehicle_id: "$vehicle_id", 
                            },
                            pipeline: [
                                {
                                    $match: {
                                        $and: [
                                            {
                                                "username": query.USER_USERNAME
                                            },
                                            {
                                                $expr: {
                                                    $eq: ["$_id","$$vehicle_id"]
                                                }
                                            }
                                        ]
                                    }
                                }
                            ],
                            as: 'vehicle',
                        }
                    },
                    { 
                        $lookup: {
                            from: 'geofences',
                            let: { 
                                origin_id: "$origin_id", 
                                destination_id: "$destination.location_id", 
                            },
                            pipeline: [
                                {
                                    $match: {
                                        $and: [
                                            {
                                                "short_name": GEOFENCE_NAME[0]
                                            },
                                            {
                                                $expr: {
                                                    $or: [
                                                        {$eq: ["$_id","$$origin_id"]},
                                                        {$eq: ["$_id","$$destination_id"]}
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }
                            ],
                            as: 'geofence',
                        }
                    },
                    { 
                        $lookup: {
                            from: 'routes',
                            localField: 'route',
                            foreignField: '_id',
                            as: 'route',
                        }
                    },
                    { $unwind: "$vehicle" }, // do not preserveNull. vehicle is required 
                    { $unwind: "$geofence" }, // do not preserveNull. geofence is required 
                    { $unwind: "$route" }, // do not preserveNull. Route is required
                ]).toArray().then(docs => {
                    var _ids = {
                        entered_origin: [],
                        queueingAtOrigin: [],
                        processingAtOrigin: [],
                        idlingAtOrigin: [],
                        in_transit: [],
                        complete: []
                    },
                    dispatch = {};
                    
                    if(docs.length > 0){
                        saveVehicleLocation(function(){
    
                            for(var i = 0; i < docs.length; i++){
                                var doc = docs[i],
                                    isOrigin = (doc.geofence._id.toString()==doc.origin_id.toString()),
                                    isDestination = (doc.geofence._id.toString()==doc.destination.location_id.toString()),
                                    getIndexOf = function(arr,op){
                                        var cond = null;
                                        arr.forEach(val => {
                                            if(op == "or" && !cond){
                                                cond = (query.RULE_NAME.indexOf(val) > -1);
                                            }
                                            if(op == "and" && (cond == null || cond == true)){
                                                cond = (query.RULE_NAME.indexOf(val) > -1);
                                            }
                                        });
                                        return cond;
                                    };
                                
                                console.log("doc.scheduled_date",doc.scheduled_date);
                                if(!doc.scheduled_date || (moment().valueOf() >= moment(doc.scheduled_date).valueOf())){
                                    // if already has entered_origin
                                    if(Object.keys(doc.events_captured||{}).length == 0 && query.RULE_NAME == "Inside Geofence" && query.stage == "start"){
                                        if(["assigned"].includes(doc.status) && isOrigin === true){
                                            _ids.entered_origin.push(doc._id);
                                        }
                                    } 
    
                                    if(Object.keys(doc.events_captured||{}).length > 0){
                                        // origin
                                        if(getIndexOf(["Inside Geofence","Queueing"],"and") && !["queueingAtOrigin","in_transit"].includes(doc.status) && isOrigin === true){
                                            _ids.queueingAtOrigin.push(doc._id);
                                        }
                                        if(getIndexOf(["Inside Geofence","Processing"],"and") && !["processingAtOrigin","in_transit"].includes(doc.status) && isOrigin === true){
                                            _ids.processingAtOrigin.push(doc._id);
                                        }
                                        if(getIndexOf(["Inside","Idle"],"and") && !["idlingAtOrigin","in_transit"].includes(doc.status) && isOrigin === true){
                                            _ids.idlingAtOrigin.push(doc._id);
                                        }
                                        // end origin
        
                                        // in transit
                                        if(query.RULE_NAME == "Inside Geofence" && ["assigned","queueingAtOrigin","processingAtOrigin","idlingAtOrigin"].includes(doc.status) && isOrigin === true && query.stage == "end"){
                                            _ids.in_transit.push(doc._id);
                                            dispatch[doc._id] = doc;
                                        }
                                        // end in transit
        
                                        // complete
                                        if(getIndexOf(["Inside Geofence","Outside Geofence"],"or") && doc.status == "in_transit" && isDestination === true && query.stage == "start"){
                                            _ids.complete.push(doc._id);
                                        }
                                        // end complete
                                    }
                                }
                            }
        
                            var shipment_number = _ids.in_transit.concat(_ids.queueingAtOrigin).concat(_ids.processingAtOrigin).concat(_ids.complete);
        
                            if(shipment_number.length > 0){
                                console.log("shipment_number",shipment_number);
        
                                if(insertedId){
                                    eventsCollection.updateOne({_id: ObjectId(insertedId)},{ $set: {shipment_number} }).then(docs => {
                                        proceedToUpdate();
                                    }).catch(error => {
                                        console.log(error);
                                        client.close();
                                        res.status(500).send('Error in CN: ' + JSON.stringify(error));
                                    }); 
                                } else {
                                    proceedToUpdate();
                                    console.log("OH NOPE");
                                }
                            } else {
                                proceedToUpdate();
                            }
        
                            function proceedToUpdate(){
                                var childPromise = [];
                                Object.keys(_ids).forEach(function(status) {
                                    if(_ids[status].length > 0){
                                        var set = {};
                                        if(!["entered_origin"].includes(status)){
                                            set["status"] = status;
                                            set[`history.${moment(date).valueOf()}`] = `System - Status updated to '${status}'.`;
                                        }
                                        set[`events_captured.${moment(date).valueOf()}`] = status;
                                        childPromise.push(dispatchCollection.updateMany({"_id": {$in: _ids[status]}}, { $set: set, $unset: {escalation1: "",escalation2: "",escalation3: ""}}));
        
                                        if(status == "in_transit"){
                                            _ids[status].forEach(_id => {
                                                var __date = new Date(date),
                                                    obj = dispatch[_id],
                                                    transit_time = HH_MM(obj.route.transit_time),
                                                    hours = transit_time.hour,
                                                    minutes = transit_time.minute,
                                                    newSet = {};
                                                newSet[`departure_date`] = moment(__date).toISOString();
                                                newSet[`destination.0.etd`] = moment(__date).toISOString();
                                                
                                                (hours)?__date.setHours(__date.getHours() + Number(hours)):null;
                                                (minutes)?__date.setMinutes(__date.getMinutes() + Number(minutes)):null;
                                                
                                                newSet[`destination.0.eta`] = moment(__date).toISOString();
        
                                                console.log(_id,newSet);
        
                                                childPromise.push(dispatchCollection.updateOne({ _id }, { $set: newSet }));
                                            });
                                        }
                                    } else {
                                        console.log(`None [${status}]`);
                                    }
                                });
                                if(childPromise.length > 0){
                                    console.log("childPromise",childPromise.length);
                                    Promise.all(childPromise).then(data => {
                                        console.log("Promise: ",JSON.stringify(data));
                                        client.close();
                                        res.status(200).send("OK");
                                    }).catch(error => {
                                        console.log("Failed to perform promise. Error: ",JSON.stringify(error));
                                        console.log(error);
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
                        });
                    } else {
                        saveVehicleLocation(function(){
                            client.close();
                            res.status(200).send("OK");
                        });
                    }
                }).catch(error => {
                    console.log(error);
                    client.close();
                    res.status(500).send('Error in find: ' + error);
                });   
            }, (getRandomInt(2,15) * 1000)); // random number * 1 second
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};