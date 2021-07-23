const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.events = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    try {
        var queryString = Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&');
        request({
            method: 'POST',
            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/eventsCokeT1Dev?${queryString}`,
            headers: {
                "Content-Type": "application/json"
            },
            json: true,
            body: {}
        });
    } catch (error){
        console.log("Request Error",error);
    }

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/");

        const dbName = "wd-coket1",
              client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
              db = client.db(dbName),
              dbLogging = client.db(`${dbName}-logging`),
              eventsCollection = dbLogging.collection('events'),
              vehiclesHistoryCollection = db.collection('vehicles_history'),
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
            function getOriginalAddress(addr){
                addr = addr || "";
                var separator = " - ";
                
                if(addr.indexOf(" - ") > -1)
                    separator = " - ";
                else if(addr.indexOf("- ") > -1) 
                    separator = "- ";
                else if(addr.indexOf(" -") > -1)
                    separator = " -";

                var str = addr.split(separator);
                return str[0];
            }

            if(query.GEOFENCE_NAME){
                var date = (query.stage == "start") ? new Date(query["Event start time"]+"Z") : new Date(query["EVENT_TIME"]+"Z"),
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
                        timestamp: moment(date).toISOString(),
                        iamme:true
                    },
                    GEOFENCE_NAME = getOriginalAddress(query.GEOFENCE_NAME);

                var tries = 0;
                function saveEventsLogs(){
                    eventsCollection.insertOne(event).then(result => {
                        insertedId = result.insertedId;
                        console.log("insertedId",insertedId);
                        execute();
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
                    const maxLoctionLength = 20;
                    vehiclesHistoryCollection.find({_id: Number(query.ASSIGNED_VEHICLE_ID)}).toArray().then(vDocs => {
                        var vDoc = vDocs[0] || {};
                        console.log("vDoc",JSON.stringify(vDoc));
                        try {
                            var location = vDoc.location || [],
                                short_name = GEOFENCE_NAME,
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
                                    if(location.length == maxLoctionLength){
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

                            vehiclesHistoryCollection.updateOne({_id: Number(query.ASSIGNED_VEHICLE_ID)},{ $set: {location} },{upsert: true}).then(docs => {
                                callback();
                            }).catch(error => {
                                console.log(error);
                                client.close();
                                res.status(500).send('Error in V: ' + JSON.stringify(error));
                            });
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
                function execute(){
                    dispatchCollection.aggregate([
                        {
                            $match: {
                                status: {
                                    $nin: ["plan","scheduled","complete","incomplete"]
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
                                                    "short_name": GEOFENCE_NAME
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
                        dispatch = {},
                        timestampToSave = {
                            entered_origin: [],
                            queueingAtOrigin: [],
                            processingAtOrigin: [],
                            idlingAtOrigin: [],
                            in_transit: [],
                            complete: [],
                            completeInTransit: [],
                        },
                        OBJECT = {
                            sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                            getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
                        },
                        childPromise = [];
                        
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
                                    var events_captured = doc.events_captured || {};
                                    if(!doc.scheduled_date || (moment().valueOf() >= moment(doc.scheduled_date).valueOf())){
    
                                        // entered origin
                                        var hasEnteredOrigin = OBJECT.getKeyByValue(events_captured,"entered_origin");
                                        var timestampEnteredOrigin = false; // overlapped by other status if same key (date)
                                        if(query.stage == "start" && doc.status == "assigned" && !hasEnteredOrigin && isOrigin === true){
                                            timestampToSave.entered_origin.push(doc._id);
                                            timestampEnteredOrigin = true;
                                        } 
    
                                        // queueing
                                        if(getIndexOf(["Inside Geofence","Queueing"],"and") && isOrigin === true && !timestampEnteredOrigin && doc.status != "in_transit"){
                                            if(doc.status != "queueingAtOrigin"){
                                                _ids.queueingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.queueingAtOrigin.push(doc._id);
                                            }
                                        }
    
                                        // processing
                                        if(getIndexOf(["Inside Geofence","Processing"],"and") && isOrigin === true && !timestampEnteredOrigin && doc.status != "in_transit"){
                                            if(doc.status != "processingAtOrigin"){
                                                _ids.processingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.processingAtOrigin.push(doc._id);
                                            }
                                        }
    
                                        // idling
                                        if(getIndexOf(["Inside","Idle"],"and") && isOrigin === true && !timestampEnteredOrigin && doc.status != "in_transit"){
                                            if(doc.status != "idlingAtOrigin"){
                                                _ids.idlingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.idlingAtOrigin.push(doc._id);
                                            }
                                        }
        
                                        // in transit
                                        if(((query.RULE_NAME == "Inside Geofence" && query.stage == "end") || (query.RULE_NAME == "Outside Geofence" && query.stage == "start")) && doc.status != "in_transit" && isOrigin === true && !timestampEnteredOrigin){
                                            _ids.in_transit.push(doc._id);
                                            dispatch[doc._id] = doc;
                                            // timestampToSave.in_transit.push(doc._id);
                                        }
                                        // end in transit
        
                                        // complete
                                        if(!["assigned","complete"].includes(doc.status) && isDestination === true){
                                            _ids.complete.push(doc._id);
                                            // timestampToSave.complete.push(doc._id);
                                            if(doc.status == "in_transit"){} 
                                            else {
                                                var sortedEventsCaptured = OBJECT.sortByKey(events_captured);
                                                var tempTimestamp;
                                                Object.keys(sortedEventsCaptured).forEach(key => {
                                                    tempTimestamp = key;
                                                });
                                                if(tempTimestamp){
                                                    timestampToSave.completeInTransit.push({
                                                        _id: doc._id,
                                                        obj: doc,
                                                        timestamp: tempTimestamp
                                                    });
                                                }
                                            }
                                        }
                                        // end complete
                                    }
                                }
            
                                var shipment_number = _ids.in_transit.concat(_ids.queueingAtOrigin).concat(_ids.processingAtOrigin).concat(_ids.idlingAtOrigin).concat(_ids.complete);
            
                                if(shipment_number.length > 0){
                                    console.log("shipment_number",shipment_number);
            
                                    if(insertedId){
                                        eventsCollection.updateOne({_id: ObjectId(insertedId)},{ $set: {shipment_number} }).then(docs => {
                                            saveTimestamp();
                                        }).catch(error => {
                                            console.log(error);
                                            client.close();
                                            res.status(500).send('Error in CN: ' + JSON.stringify(error));
                                        }); 
                                    } else {
                                        saveTimestamp();
                                        console.log("OH NOPE");
                                    }
                                } else {
                                    saveTimestamp();
                                }
    
    
    
                                function saveTimestamp(){
                                    // will only save the events_captured. Status was not changed.
                                    Object.keys(timestampToSave).forEach(function(status) {
                                        if(status != "completeInTransit"){
                                            if((timestampToSave[status]||[]).length > 0){
                                                var set = {};
                                                set[`events_captured.${moment(date).valueOf()}`] = status;
                                                childPromise.push(dispatchCollection.updateMany({"_id": {$in: timestampToSave[status]}}, { $set: set, }));
                                            } else {
                                                console.log(`None [${status}]`);
                                            }
                                        }
                                    });
                                    proceedToUpdate();
                                }
            
                                function proceedToUpdate(){
                                    Object.keys(_ids).forEach(function(status) {
                                        if((_ids[status]||[]).length > 0){
                                            var set = {};
                                            if(!["entered_origin"].includes(status)){
                                                // will only save the both new status and events_captured.
                                                set["status"] = status;
                                                set[`history.${moment(date).valueOf()}`] = `System - Status updated to '${status}'.`;
                                                set[`events_captured.${moment(date).valueOf()}`] = status;
                                                childPromise.push(dispatchCollection.updateMany({"_id": {$in: _ids[status]}}, { $set: set, $unset: {escalation1: "",escalation2: "",escalation3: ""}}));

                                                // add coke endpoint here...
                                            }
    
    
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
            
                                                    // console.log(_id,newSet);
            
                                                    childPromise.push(dispatchCollection.updateOne({ _id }, { $set: newSet }));
                                                });
                                            }
                                            if(status == "complete" && (timestampToSave.completeInTransit||[]).length > 0){
                                                timestampToSave.completeInTransit.forEach(val => {
                                                    var newSet = {};
                                                    newSet[`events_captured.${val.timestamp}`] = "in_transit";
                                                    set[`history.${val.timestamp}`] = `System - Status updated to 'in_transit'.`;
    
                                                    var __date = new Date(Number(val.timestamp)),
                                                        obj = val.obj,
                                                        transit_time = HH_MM(obj.route.transit_time),
                                                        hours = transit_time.hour,
                                                        minutes = transit_time.minute;
    
                                                    newSet[`departure_date`] = moment(__date).toISOString();
                                                    newSet[`destination.0.etd`] = moment(__date).toISOString();
                                                    
                                                    (hours)?__date.setHours(__date.getHours() + Number(hours)):null;
                                                    (minutes)?__date.setMinutes(__date.getMinutes() + Number(minutes)):null;
                                                    
                                                    newSet[`destination.0.eta`] = moment(__date).toISOString();
            
                                                    // console.log("C",val._id,newSet);
                                                    childPromise.push(dispatchCollection.updateOne({"_id": val._id}, { $set: newSet }));
                                                });
                                            }
                                        } else {
                                            console.log(`None [${status}]`);
                                        }
                                    });
                                    if((childPromise||[]).length > 0){
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
                }
            } else {
                res.status(500).send('Error: Invalid parameters.');
            }
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};