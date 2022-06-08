/**
* eventsOrientFreight_Shipments
* 
* >> Save the Vehicle's Location History and check if dispatch entries' status should be updated <<
* 
* Whether there are dispatch entries to be updated or not, location history of the vehicle MUST be updated.
* Dispatch entries are filtered by status, vehicle, and geofence
* 
*/

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
 
// PRODUCTION
// const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const now = moment.tz(undefined, undefined, timezone); // get current time

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });

        // array of promises
        const childPromise = [];

        var hasError = false; // check if there were error/s during process(). 
                            // the reason for this is to send status 500 after all CLIENTS are done 
                            // instead of returning error immediately while other CLIENTS (if available) 
                            // have not yet undergone through process().
        /************** end Variable Initialization **************/

        // request data
        const method = req.method;
        const body = req.body;
        const query = req.query;
        
        // print request data
        console.log("Method:",method," | DateTime: ",moment(new Date()).format("MM/DD/YYYY hh:mm:ss A"));
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));
        console.log("Filtered:",`${query.GEOFENCE_NAME} - ${query.USER_NAME} (${query.USER_USERNAME})`);

        // initialize database
        const dbName = "orient_freight";

        const db = client.db('wd-'+dbName);
        const dispatchCollection = db.collection('dispatch');

        const dbLogging = client.db(`wd-${dbName}-logging`);
        const eventsCollection = dbLogging.collection('events');

        const otherDb = client.db(dbName);
        const geofencesCollection = otherDb.collection('geofences');
        const vehiclesHistoryCollection = otherDb.collection('vehicles_history');


        // function that retrieves the original address
        // Eg. 
        // Geofence Name: CNL PL - Queueing Area
        // Original Address: CNL PL
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

        // if GEOFENCE_NAME is not null or undefined
        if(query.GEOFENCE_NAME){
            // date and time variables (moment)
            const startTime = moment.tz(query["Event start time"]+"Z", undefined, timezone);
            const eventTime = moment.tz(query["EVENT_TIME"]+"Z", undefined, timezone);
            const finalTime = (query.stage == "start") ? startTime : eventTime;

            // ID of the inserted Event
            const insertedId = query.insertedId;

            // get original address of the GEOFENCE_NAME
            const GEOFENCE_NAME = getOriginalAddress(query.GEOFENCE_NAME);

            // function that saves/updates the vehicle's last location history
            function saveVehicleLocation(callback){

                // maximum location to be saved per vehicle
                const maxLocationLength = 20;
                
                // retrieve vehicle location history by vehicle id
                vehiclesHistoryCollection.find({_id: Number(query.ASSIGNED_VEHICLE_ID)}).toArray().then(vDocs => {
                    const vDoc = vDocs[0] || {};

                    // location data
                    const location = vDoc.location || [];
                    const newEventData = { 
                        RULE_NAME: query.RULE_NAME, 
                        stage: query.stage, 
                        timestamp: finalTime.toISOString()
                    };

                    // used to check if a new data was inserted/pushed to vehicle's location history
                    var isPushed = false;

                    try {
                        // loop through last 2 locations from latest to oldest
                        // Eg. [1,2,3,4,5,6,7] ----> We only need to loop or get data 7 & 6
                        for(var i = location.length-1; i >= location.length-2; i--){
                            // if location name is equal to this event's location
                            if(location[i].short_name == GEOFENCE_NAME){
                                // push new data
                                location[i].events.push(newEventData);
                                isPushed = true;
                                break;
                            } else {
                                // if location history reached the maximum location history length, remove the last OLDEST location data
                                if(location.length == maxLocationLength){
                                    location.splice(0,1);
                                }
                                // push new data
                                location.push({
                                    short_name: GEOFENCE_NAME,
                                    events: [ newEventData ]
                                });
                                isPushed = true;
                                break;
                            }
                        }
                    } catch(error){
                        // Do not isDone. Error setHeaders...
                        console.log('Vehicle History (Try/Catch)',error);
                    }
                        
                    // if no data was pushed
                    if(!isPushed){
                        // push new data
                        location.push({
                            short_name: GEOFENCE_NAME,
                            events: [ newEventData ]
                        });
                    }

                    // update the location history of vehicle
                    // upsert is true to make it automatically insert if find query failed
                    vehiclesHistoryCollection.updateOne({_id: Number(query.ASSIGNED_VEHICLE_ID)},{ $set: {location} },{upsert: true}).then(docs => {
                        callback();
                    }).catch(error => {
                        isDone('Vehicle History (Update)',error);
                    });
                }).catch(error => {
                    isDone('Vehicle History (Find)',error);
                });
            }

            // get geofence data of this event
            geofencesCollection.find({ short_name: GEOFENCE_NAME }).toArray().then(gDocs => {

                const gDoc = gDocs[0];

                if(gDoc){

                    // find dispatch entries based on the complex queries
                    dispatchCollection.aggregate([
                        // status must not be plan, scheduled, complete, or incomplete
                        {
                            $match: {
                                status: {
                                    $nin: ["plan","scheduled","complete","incomplete"]
                                },
                                vehicle_id: Number(query.ASSIGNED_VEHICLE_ID),
                                $or: [
                                    {
                                      'destination.0.location_id': ObjectId(gDoc._id)
                                    },
                                    {
                                      'origin_id': ObjectId(gDoc._id)
                                    }
                                ]
                            }
                        },
        
                        // unwind 'destination'. Meaning to deconstruct the destination array. 
                        // Ex. destination = [ { short_name: "ABC" } ]
                        // After unwind: { short_name: "ABC" }
                        { $unwind: "$destination" },
        
                        // // vehicle must be the same as this event's vehicle
                        // { 
                        //     $lookup: {
                        //         from: 'vehicles',
                        //         let: { 
                        //             vehicle_id: "$vehicle_id", 
                        //         },
                        //         pipeline: [
                        //             {
                        //                 $match: {
                        //                     $and: [
                        //                         {
                        //                             "username": query.USER_USERNAME
                        //                         },
                        //                         {
                        //                             $expr: {
                        //                                 $eq: ["$_id","$$vehicle_id"]
                        //                             }
                        //                         }
                        //                     ]
                        //                 }
                        //             }
                        //         ],
                        //         as: 'vehicle',
                        //     }
                        // },
        
                        // origin OR destination geofences must be the same as this event's geofence
                        // { 
                        //     $lookup: {
                        //         from: 'geofences',
                        //         let: { 
                        //             origin_id: "$origin_id", 
                        //             destination_id: "$destination.location_id", 
                        //         },
                        //         pipeline: [
                        //             {
                        //                 $match: {
                        //                     $and: [
                        //                         {
                        //                             "short_name": GEOFENCE_NAME
                        //                         },
                        //                         {
                        //                             $expr: {
                        //                                 $or: [
                        //                                     {$eq: ["$_id","$$origin_id"]},
                        //                                     {$eq: ["$_id","$$destination_id"]}
                        //                                 ]
                        //                             }
                        //                         }
                        //                     ]
                        //                 }
                        //             }
                        //         ],
                        //         as: 'geofence',
                        //     }
                        // },
        
                        // get the route data from route db
                        { 
                            $lookup: {
                                from: 'routes',
                                localField: 'route',
                                foreignField: '_id',
                                as: 'route',
                            }
                        },
        
                        // refer the $unwind destination for example
                        // { $unwind: "$vehicle" }, // do not preserveNull. vehicle is required 
                        // { $unwind: "$geofence" }, // do not preserveNull. geofence is required 
                        { $unwind: "$route" }, // do not preserveNull. Route is required
                    ]).toArray().then(docs => {
                            
                        // store dispatch _ids
                        const _ids = {
                            queueingAtOrigin: [],
                            processingAtOrigin: [],
                            idlingAtOrigin: [],
                            in_transit: [],
                            onSite: [],
                            returning: [],
                            complete: [],
                            incomplete: []
                        };
        
                        // used to save the _ids where only timestamp will be saved
                        // There are times that the truck already reached destination even though it's not yet tagged as 'In Transit'.
                        // Ex. 12:00 PM - Queueing
                        //     01:00 PM - Processing
                        //     02:00 PM - Complete - It was not tagged as 'In Transit'
                        // On rare occasions, trucks are not able to send event to WD that the truck already left but we must be able to catch it and
                        // complete the shipment. We use the latest timestamp saved in shipment and set that as our 'In Transit' time.
                        // Sp the purpose of 'timestampToSave' is to always save the latest timestamps.
                        const timestampToSave = {
                            entered_origin: [],
                            queueingAtOrigin: [],
                            processingAtOrigin: [],
                            idlingAtOrigin: [],
                            in_transit: [],
                            onSite: [],
                            returning: [],
                            complete: [],
                            incomplete: []
                        };
                        // store necessary data of shipment to make it 'On Site'
                        const onSiteNotInTransit = [];
        
                        // Just for reference
                        // On March/April of 2021, it was discussed that instead of a linear way of updating shipment status,
                        // we'll follow wherever the truck is. 
                        // Before: Assigned -> Queueing -> Processing -> Idling -> In Transit -> Complete
                        // After: Assigned -> Queueing -> Processing -> Queueing -> Idling -> Processing -> Queueing -> In Transit -> Complete
        
                        
                        // extra function for objects
                        const OBJECT = {
                            sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                            getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
                        };
                        
                        // if there's at least one (1) dispatch entry, 
                        if(docs.length > 0){
                            // just save vehicle location then proceed to detecting new status
                            saveVehicleLocation(function(){
        
                                // loop through the dispatch entries
                                for(var i = 0; i < docs.length; i++){
                                    // current entry's data
                                    const doc = docs[i];
        
                                    // check if entry's origin geofence is the same as this event's geofence
                                    const isOrigin = (gDoc._id.toString()==doc.origin_id.toString());
        
                                    // check if entry's destination geofence is the same as this event's geofence
                                    const isDestination = (gDoc._id.toString()==doc.destination.location_id.toString());
        
                                    // this function checks if TEXT contains strings inside ARR. "or" - at least one string in ARR; "and" - all strings in ARR
                                    function getIndexOf(arr,op){
                                        var cond = null;
                                        arr.forEach(val => {
                                            (op == "or" && !cond) ? cond = (query.RULE_NAME.indexOf(val) > -1) : null;
                                            (op == "and" && (cond == null || cond == true)) ? cond = (query.RULE_NAME.indexOf(val) > -1) : null;
                                        });
                                        return cond;
                                    }
                                    
                                    // events captured of this shipment
                                    const events_captured = doc.events_captured || {};
        
                                    // >>>>> ENTERED ORIGIN
                                    // check if there's no 'entered_origin' in events_captured yet
                                    const hasEnteredOrigin = OBJECT.getKeyByValue(events_captured,"entered_origin");
                                    if(query.stage == "start" && doc.status == "assigned" && query.RULE_NAME != "Outside Geofence" && !hasEnteredOrigin && isOrigin === true){
                                        // save timestamp of entered_origin
                                        timestampToSave.entered_origin.push(doc._id);
                                    } else {
                                        // >>>>> QUEUEING
                                        if(getIndexOf(["Inside Geofence","Queueing"],"and") && isOrigin === true && doc.status != "in_transit"){
                                            if(doc.status != "queueingAtOrigin"){
                                                _ids.queueingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.queueingAtOrigin.push(doc._id);
                                            }
                                        }
            
                                        // >>>>> PROCESSING
                                        if(getIndexOf(["Inside Geofence","Processing"],"and") && isOrigin === true && doc.status != "in_transit"){
                                            if(doc.status != "processingAtOrigin"){
                                                _ids.processingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.processingAtOrigin.push(doc._id);
                                            }
                                        }
            
                                        // >>>>> IDLING
                                        if(getIndexOf(["Inside","Idle"],"and") && isOrigin === true && doc.status != "in_transit"){
                                            if(doc.status != "idlingAtOrigin"){
                                                _ids.idlingAtOrigin.push(doc._id);
                                            } else {
                                                timestampToSave.idlingAtOrigin.push(doc._id);
                                            }
                                        }
            
                                    // >>>>> IN TRANSIT
                                    if(((query.RULE_NAME == "Inside Geofence" && query.stage == "end") || (query.RULE_NAME == "Outside Geofence" && query.stage == "start")) && doc.status != "in_transit" && isOrigin === true){
                                        _ids.in_transit.push(doc._id);
                                    }
        
                                        // >>>>> ON-SITE
                                    if(query.RULE_NAME == "Inside Geofence" && query.stage == "start" && isDestination === true){
                                        
                                        // store _id of shipment for 'onSite' status
                                        _ids.onSite.push(doc._id);
        
                                        // if status is In Transit, ignore
                                        if(doc.status == "in_transit"){} 
                                        else {
                                            // get the last timestamp
                                            const lastTimestamp = Object.keys(events_captured)
                                                                    .map(key => { return Number(key); }) // return timestamp (converted to Number)
                                                                    .sort()   // sort values in ascending order
                                                                    .reverse() // reverse order (descending order)
                                                                    [0];  // get first value of array
        
                                            // if lastTimestamp exists
                                            if(lastTimestamp){
                                                // save necessary data to 'onSiteNotInTransit' object
                                                onSiteNotInTransit.push({
                                                    _id: doc._id,
                                                    timestamp: Number(lastTimestamp)
                                                });
                                            }
                                        }
                                    }
        
                                    // >>>>> RETURNING
                                    if(((query.RULE_NAME == "Inside Geofence" && query.stage == "end") || (query.RULE_NAME == "Outside Geofence" && query.stage == "start")) && doc.status == "onSite" && isDestination === true){
                                        _ids.returning.push(doc._id);
                                    }
            
                                    // >>>>> COMPLETE
                                    if(doc.status == "returning" && isOrigin === true){
                                        _ids.complete.push(doc._id);
                                    }
        
                                    // >>>>> INCOMPLETE
                                    // if truck has returned to the origin without entering destination geofence - tag as INCOMPLETE
                                    if(query.RULE_NAME == "Inside Geofence" && isOrigin === true && doc.status == "in_transit"){
                                        
                                        // get the last in_transit timestamp
                                        const lastInTransitTimestamp = Object.keys(events_captured)
                                                                        .map(key => { return (a[key] == "in_transit") ? Number(key) : null; }) // return timestamp if value is "in_transit", else null
                                                                        .sort()   // sort values in ascending order
                                                                        .reverse() // reverse order (descending order)
                                                                        .filter(n => n); // remove all null values from array
                                        
                                        // if timestamp exists
                                        if(lastInTransitTimestamp){
                                            const minuteDifference = moment().diff(lastInTransitTimestamp, "minutes");
        
                                            // give 20 minutes time difference in case an event was sent to WD just seconds after truck left the origin geofence.
                                            if(minuteDifference > 20){
                                                timestampToSave.incomplete.push(doc._id);
                                            }
                                        }
                                    }
                                    }
                                }
        
                                // merge all entry IDs
                                const shipment_number = _ids.in_transit.concat(_ids.queueingAtOrigin).concat(_ids.processingAtOrigin).concat(_ids.idlingAtOrigin).concat(_ids.onSite).concat(_ids.returning).concat(_ids.complete).concat(_ids.incomplete);
        
                                if(shipment_number.length > 0){
                                    // if 'insertedId' is not null or undefined
                                    if(insertedId){
                                        // update events - add list of dispatch entry ids that were affected by this event
                                        eventsCollection.updateOne({_id: ObjectId(insertedId)},{ $set: {shipment_number} }).then(docs => {
                                            // proceed to save timestamps
                                            saveTimestamp();
                                        }).catch(error => {
                                            isDone('Events (Update)',error);
                                        }); 
                                    } else {
                                        // proceed to save timestamps
                                        saveTimestamp();
                                    }
                                } else {
                                    // proceed to save timestamps
                                    saveTimestamp();
                                }
        
                                // functions that only saves/updates the events_captured. Status will not be changed.
                                function saveTimestamp(){
                                    // loop object
                                    Object.keys(timestampToSave).forEach(function(status) {
                                        // if array has at least one (1) element
                                        if((timestampToSave[status]||[]).length > 0){
        
                                            // store events captured with timestamp 
                                            var set = {};
                                            set[`events_captured.${finalTime.valueOf()}`] = status;
        
                                            // add promise to childPromise
                                            childPromise.push( dispatchCollection.updateMany({"_id": {$in: timestampToSave[status]}}, { $set: set, }) );
                                        } else {
                                            // print for debugging
                                            console.log(`None [${status}]`);
                                        }
                                    });
        
                                    // proceed to update
                                    proceedToUpdate();
                                }
        
                                
                                // function that updates the dispatch entries
                                // To be updated: status, departure_date, escalation levels
                                function proceedToUpdate(){
                                    Object.keys(_ids).forEach(function(status) {
                                        if((_ids[status]||[]).length > 0){
        
                                            // ------> will only save the status, history, and events_captured
                                            // add to 'set' object the changes
                                            const set = {};
        
                                            set["status"] = status;
                                            // add timestamp key to entry's history
                                            set[`history.${finalTime.valueOf()}`] = `System - Status updated to '${status}'.`;
                                            // add timestamp key to entry's events_captured
                                            set[`events_captured.${finalTime.valueOf()}`] = status;
        
                                            // add update to childpromise array
                                            childPromise.push( dispatchCollection.updateMany(
                                                { "_id": { $in: _ids[status] } }, 
                                                { 
                                                    $set: set,
        
                                                    // every time the status changes, unset the delay escalations
                                                    $unset: {
                                                        escalation1: "",
                                                        escalation2: "",
                                                        escalation3: ""
                                                    }
                                                }
                                            ));
        
        
                                            // if the status is in_transit, there'll be additional updates
                                            if(status == "in_transit"){
                                                // loop _ids for in_transit property
                                                _ids[status].forEach(_id => {
                                                    // get the target transit time based on route
                                                    const transit_time = ((docs.find(x => x._id == _id)||{}).route||{}).transit_time;
                                                    const hours = transit_time.hour;
                                                    const minutes = transit_time.minute;
        
                                                    // add to 'newSet' object the changes
                                                    const newSet = {};
        
                                                    // save departure date and etd
                                                    newSet[`departure_date`] = finalTime.toISOString();
                                                    newSet[`destination.0.etd`] = finalTime.toISOString();
                                                    
                                                    // add the target transit hour and minutes to the actual transit datetime
                                                    const eta = finalTime.add(Number(hours), 'hours').add(Number(minutes), 'minutes').toISOString();
                                                    // save the eta
                                                    newSet[`destination.0.eta`] = eta;
        
                                                    // add update to childpromise array
                                                    childPromise.push( dispatchCollection.updateOne({ _id }, { $set: newSet }) );
                                                });
                                            }
        
                                            // if the status is onSite and theres at least one (1) element in 'onSiteNotInTransit', there'll be additional updates
                                            if(status == "onSite" && (onSiteNotInTransit||[]).length > 0){
        
                                                // loop array
                                                onSiteNotInTransit.forEach(val => {
        
                                                    // add to 'newSet' object the changes
                                                    const newSet = {};
        
                                                    // add timestamp key to entry's history based on the supposedly 'in transit time'
                                                    newSet[`events_captured.${val.timestamp}`] = "in_transit";
                                                    // add timestamp key to entry's events_captured based on the supposedly 'in transit time'
                                                    newSet[`history.${val.timestamp}`] = `System - Status updated to 'in_transit'.`;
        
                                                    // get the target transit time based on route
                                                    const transit_time = ((docs.find(x => x._id == val._id)||{}).route||{}).transit_time;
                                                    const hours = transit_time.hour;
                                                    const minutes = transit_time.minute;
        
                                                    // convert timestamp to moment()
                                                    const inTransitTimestamp = moment.tz(val.timestamp, undefined, timezone);
        
                                                    // save departure date and etd
                                                    newSet[`departure_date`] = inTransitTimestamp.toISOString();
                                                    newSet[`destination.0.etd`] = inTransitTimestamp.toISOString();
                                                    
                                                    // add the target transit hour and minutes to the actual transit datetime
                                                    const eta = inTransitTimestamp.add(Number(hours), 'hours').add(Number(minutes), 'minutes').toISOString();
                                                    // save the eta
                                                    newSet[`destination.0.eta`] = eta;
        
                                                    // add update to childpromise array
                                                    childPromise.push( dispatchCollection.updateOne({ _id: val._id }, { $set: newSet }) );
                                                });
                                            }
                                        } else {
                                            // print for debugging
                                            console.log(`None [${status}]`);
                                        }
                                    });
        
                                    // if there's at least one (1) promise to execute
                                    if(childPromise.length > 0){
                                        // print for debugging
                                        console.log("Child promises:",childPromise.length);
        
                                        // execute promises
                                        Promise.all(childPromise).then(data => {
                                            // print for debugging
                                            console.log("Promise: ",JSON.stringify(data));
                                            isDone();
                                        }).catch(error => {
                                            isDone("Promise",error);
                                        });
                                    } else {
                                        console.log("Empty Promise");
                                        isDone();
                                    }
                                }
                            });
                        } else {
                            // just save the location data
                            saveVehicleLocation(function(){
                                isDone();
                            });
                        }
                    }).catch(error => {
                        isDone("Dispatch (Aggregate)",error);
                    }); 
                } else {
                    // just save the location data
                    saveVehicleLocation(function(){
                        isDone();
                    });
                }
            });


            // will resolve the function depending if there was an error or not. Also, this will display the error if an error is passed
            function isDone(errTitle,err){
                // if error, display the title and error
                if(err) {
                    console.log(`Error in ${errTitle}:`,err);
                    hasError = true;
                }
                
                // close client connection
                client.close();

                // resolve as 500 if there's an error and 200 if no error
                res.status(hasError?500:200).send(hasError?"ERROR":"OK");
            }
        } else {
            // close client connection
            client.close();
            
            // return error
            res.status(500).send('Error: Invalid parameters.');
        }
    }).catch(function(error) {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});