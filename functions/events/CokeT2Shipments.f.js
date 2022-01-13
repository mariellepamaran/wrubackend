/**
 * eventsCokeT2Shipments
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
 
// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

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
        console.log("Method:",method," | DateTime: ",now.format("MM/DD/YYYY hh:mm:ss A"));
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));
        console.log("Filtered:",`${query.GEOFENCE_NAME} - ${query.USER_NAME} (${query.USER_USERNAME})`);

        // initialize database
        const dbName = "coket2";
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

            // get original address of the GEOFENCE_NAME
            const GEOFENCE_NAME = getOriginalAddress(query.GEOFENCE_NAME);
            // the truck's base site
            const TRUCK_SITE = query["Site"];

            // ID of the inserted Event
            const insertedId = query.insertedId;

            // function that saves/updates the vehicle's last location history
            function saveVehicleLocation(callback){

                // maximum location to be saved per vehicle
                const maxLocationLength = 20;

                // retrieve vehicle location history by vehicle id
                vehiclesHistoryCollection.find({_id: Number(query.ASSIGNED_VEHICLE_ID)}).toArray().then(vDocs => {
                    const vDoc = vDocs[0] || {};
                    
                    // location data
                    const location = vDoc.location || [];
                    const lastLocation = location[location.length-1];
                    const newEventData = { 
                        RULE_NAME: query.RULE_NAME, 
                        stage: query.stage, 
                        timestamp: finalTime.toISOString()
                    };

                    // used to check if a new data was inserted/pushed to vehicle's location history
                    var isPushed = false;
                    
                    try {
                        // if last location exists
                        if(lastLocation){
                            // if location name is equal to this event's location
                            if(lastLocation.short_name == GEOFENCE_NAME){
                                // push data to last location's EVENT array
                                lastLocation.events.push( newEventData );
                                isPushed = true;
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
                        // status must not be plan, complete, or incomplete
                        {
                            $match: {
                                status: {
                                    $nin: ["plan","complete","incomplete"]
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
                        // // origin geofence must be the same as this event's geofence
                        // { 
                        //     $lookup: {
                        //         from: 'geofences',
                        //         let: { 
                        //             origin_id: "$origin_id", 
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
                        // { $unwind: "$vehicle" }, // do not preserveNull. vehicle is required 
                        // { $unwind: "$geofence" }, // do not preserveNull. geofence is required 
                    ]).toArray().then(docs => {

                        // store dispatch _ids
                        const _ids = {
                            assigned: [],
                            onDelivery: [],
                            complete: []
                        };
                        
                        // if there's at least one (1) dispatch entry, 
                        if(docs.length > 0){
                            // just save vehiccle location then proceed to detecting new status
                            saveVehicleLocation(function(){

                                // loop through the dispatch entries
                                for(var i = 0; i < docs.length; i++){
                                    // current entry's data
                                    const doc = docs[i];

                                    // check if entry's origin geofence is the same as this event's geofence
                                    const isOrigin = (gDoc._id.toString()==doc.origin_id.toString());

                                    // check if entry's truck's base site is the same as this event's geofence
                                    const isTruckBaseSite = TRUCK_SITE == GEOFENCE_NAME;
                                
                                    // Just a reminder
                                    // The "Check Out" event is like 'enroute' event. Instead of wanting to know how long the truck stayed at the geofence,
                                    // it wants to know how long it took the truck to travel from one location to another
                                    // Eg. 
                                    // Check Out (Start) (2:00 PM): CNL PL
                                    // Check Out (End) (3:00 PM): STAROSA PL
                                    // Meaning, the truck LEFT CNL PL at 2:00 PM and ARRIVED in STAROSA PL at 3:00 PM
                                    // It's like the opposite logic with CokeT1's "Inside Geofence" event


                                    // so it's less confusing, the 'arriving' and 'leaving' condition is stored in the following variables
                                    const arrivedAtGeofence = (query.RULE_NAME == "Check Out" && query.stage == "end");
                                    const leftGeofence = (query.RULE_NAME == "Check Out" && query.stage == "start");

                                    console.log("HERE",
                                                `ID: ${doc._id}`,
                                                `arrivedAtGeofence: ${arrivedAtGeofence}`,
                                                `leftGeofence: ${leftGeofence}`,
                                                `Status: ${doc.status}`,
                                                `isOrigin: ${isOrigin}`,
                                                `isTruckBaseSite: ${isTruckBaseSite}`);

                                    // Status logic is based on Coke's T2_Dispatch_Matrix.xlsx file
                                    // // assigned
                                    // if(arrivedAtGeofence && doc.status != "assigned" && isOrigin === true){
                                    //     _ids.assigned.push(doc._id);
                                    // }
                                    // // end assigned


                                    // onDelivery
                                    if(leftGeofence && ["assigned"].includes(doc.status) && isOrigin === true){
                                        _ids.onDelivery.push(doc._id);
                                    }
                                    // end onDelivery


                                    // complete
                                    if(doc.support_unit === "Yes") {
                                        // origin site
                                        if(arrivedAtGeofence && doc.status == "onDelivery" && isOrigin === true){
                                            _ids.complete.push(doc._id);
                                        }
                                    } else {
                                        // truck base site
                                        if(arrivedAtGeofence && doc.status == "onDelivery" && isTruckBaseSite === true){
                                            _ids.complete.push(doc._id);
                                        }
                                    }
                                    // end complete
                                }
            
                                // merge all entry IDs
                                const shipment_number = _ids.onDelivery.concat(_ids.assigned).concat(_ids.complete);
            
                                if(shipment_number.length > 0){
                                    // if 'insertedId' is not null or undefined
                                    if(insertedId){
                                        // update events - add list of dispatch entry ids that were affected by this event
                                        eventsCollection.updateOne({_id: ObjectId(insertedId)},{ $set: { shipment_number } }).then(docs => {
                                            // proceed to update the dispatch entries
                                            proceedToUpdate();
                                        }).catch(error => {
                                            isDone('Events (Update)',error);
                                        }); 
                                    } else {
                                        // proceed to update the dispatch entries
                                        proceedToUpdate();
                                    }
                                } else {
                                    // proceed to update the dispatch entries
                                    proceedToUpdate();
                                }


            
                                // function that updates the dispatch entries
                                // To be updated: status, departure_date, escalation levels
                                function proceedToUpdate(){

                                    // loop through each '_ids' object properties
                                    Object.keys(_ids).forEach(status => {
                                        // if object status has at least 1 entry
                                        if((_ids[status]||[]).length > 0){

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

                                            // if entry is on delivery, save the departure date
                                            if(status == "onDelivery"){
                                                // loop per status of _ids object
                                                _ids[status].forEach(_id => {
                                                    childPromise.push( dispatchCollection.updateOne(
                                                        { _id }, 
                                                        { 
                                                            $set: {
                                                                departure_date: finalTime.toISOString()
                                                            }
                                                        }
                                                    ));
                                                });
                                            }
                                        } else {
                                            // print text. Can delete this anytime
                                            console.log(`None [${status}]`);
                                        }
                                    });
                                    
                                    if(childPromise.length > 0){
                                        console.log("childPromise length: ",childPromise.length);
                                        // execute the Promise.all() method
                                        Promise.all(childPromise).then(data => {
                                            console.log("Promise: ",JSON.stringify(data));
                                            isDone();
                                        }).catch(error => {
                                            isDone('Promise',error);
                                        });
                                    } else {
                                        console.log("Empty Promise");
                                        isDone();
                                    }
                                }
                            });
                        } else {
                            // just save vehiccle location then resolve function
                            saveVehicleLocation(function(){
                                isDone();
                            });
                        }
                    }).catch(error => {
                        isDone('Dispatch (Find)',error);
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