/**
 * scheduledShipment
 * 
 * >> Update a shipment's status to appropriate status when it's schedule is due <<
 * 
 * This function looks through the scheduled shipments and check if the schedule is due. 
 * Clients have the option to choose how many minute/s before the specified schedule the shipment will be updated.
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');

// PRODUCTION
// const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.scheduledShipmentxDev = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    
    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const format = {
            date: "MMM DD, YYYY",
            time: "h:mm A",
            datetime: "MMM DD, YYYY, h:mm A"
        };
        const now = moment.tz(undefined, undefined, timezone); // get current time
        const now_ms = now.valueOf(); // get current time in milliseconds

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });
        
        // list of clients. Key is usually the db name
        const CLIENTS = {
            "wilcon":null,
        };
        const CLIENT_OPTIONS = {
            // 0 means exactly on schedule. 
            // Greater than 0 means X minutes before schedule
            "wilcon": { activateInMinutes: 60, defaultStatus: "assigned" } 
        };

        // array of promises
        const childPromise = [];

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function process(clientName){
            // initialize database
            const db = client.db('wd-'+clientName);
            const dispatchCollection = db.collection('dispatch');

            const otherDb = client.db(clientName);
            const geofencesCollection = otherDb.collection('geofences');
            const vehiclesHistoryCollection = otherDb.collection('vehicles_history');

            // get Client's default shipment status
            const defaultStatus = CLIENT_OPTIONS[clientName].defaultStatus;

            // extra function for objects
            const OBJECT = {
                sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
            };

            // retrieve shipments with status "scheduled"
            dispatchCollection.find({ status: "scheduled" }).toArray().then(docs => {
                const vehicleIds = [];
                const originIds = [];
                const entries = [];

                // check whether NOW is within schedule date
                function withinSchedule(minDate,shiftTime){
                    // format date to MMM DD, YYYY
                    minDate = moment.tz(minDate, undefined, timezone).format(format.date);

                    // split shift schedule into minimum and maximum time.
                    // Sample Original format: 12:00 AM - 3:00 PM
                    shiftTime = (shiftTime||"").split(" - ");

                    const minTime = shiftTime[0]; // minimum time - 12:00 AM
                    const maxTime = shiftTime[1]; // maximum time - 3:00 PM

                    // convert minimum time to moment object
                    const minTimeMoment = moment.tz(minTime, format.time, timezone);
                    // convert maximum time to moment object
                    const maxTimeMoment = moment.tz(maxTime, format.time, timezone);
                    // if maximum time is before minimum time, add 1 day to date
                    // Reason: shifts like "July 28, 2021 - 8:00 PM - 1:00 AM"
                    // Goal: Min DateTime = July 28, 2021, 8:00 PM
                    //       Max DateTime = July 29, 2021, 1:00 AM
                    const maxDate = (maxTimeMoment.isBefore(minTimeMoment)) ? moment.tz(minDate, format.date, timezone).add(1,"day") : minDate;
                    
                    // activate entry XX minutes BEFORE scheduled date and time. Default value is 0.
                    // Eg. Schedule: July 28, 2021 (8:00 PM - 1:00 AM)
                    //     activateInMinutes: 60
                    //     Result: Activate entry on July 28, 2021, 7:00 PM
                    const minutes = (CLIENT_OPTIONS[clientName]||{}).activateInMinutes || 0;

                    // get the minimum date and time minus X minutes in milliseconds
                    const minSchedule = moment.tz(`${minDate}, ${minTime}`, format.datetime, timezone).subtract(minutes,"minutes").valueOf();
                    // get the maximum date and time in milliseconds
                    const maxSchedule = moment.tz(`${maxDate}, ${maxTime}`, format.datetime, timezone).valueOf();

                    // return true if NOW is between minimum schedule and maximum schedule
                    return (now_ms >= minSchedule && now_ms <= maxSchedule);
                }

                // loop each shipment
                docs.forEach(val => {
                    // check whether NOW is within schedule date
                    if(withinSchedule(val.scheduled_date,val.shift_schedule)){
                        console.log("In schedule",val.scheduled_date,val.shift_schedule,val._id);

                        // add unique vehicle ID to array
                        (!vehicleIds.includes(Number(val.vehicle_id))) ? vehicleIds.push(Number(val.vehicle_id)) : null;
                        // add unique origin ID to array
                        (!originIds.includes(ObjectId(val.origin_id))) ? originIds.push(ObjectId(val.origin_id)) : null;
                        // add entry to array
                        entries.push({
                            _id: val._id,
                            vehicle_id: Number(val.vehicle_id),
                            origin_id: val.origin_id
                        });
                    }
                });

                // print entries that are in schedule
                console.log("Entries",entries);

                if(entries.length > 0){
                    // retrieve vehicles where ID is in vehicleIds array
                    vehiclesHistoryCollection.find({ _id: { $in: vehicleIds } }).toArray().then(vhDocs => {
                        // retrieve geofences where ID is in originIds array
                        geofencesCollection.find({ _id: { $in: originIds } }).toArray().then(gDocs => {
                            // loop through entries array
                            entries.forEach(eVal => {

                                // this function checks if TEXT contains strings inside ARR. "or" - at least one string in ARR; "and" - all strings in ARR
                                function getIndexOf(text,arr,op){
                                    var cond = null;
                                    arr.forEach(val => {
                                        (op == "or" && !cond) ? cond = (text.indexOf(val) > -1) : null;
                                        (op == "and" && (cond == null || cond == true)) ? cond = (text.indexOf(val) > -1) : null;
                                    });
                                    return cond;
                                }

                                function getStatusAndEvents(originEvents){

                                    // save the truck events captured for this shipment
                                    const eventsCaptured = {};

                                    // set status to Client's default shipment status
                                    var status = defaultStatus;

                                    // loop origin events
                                    for(var i = originEvents.length-1; i >= 0; i--){
                                        const val = originEvents[i];
                                        
                                        // convert time to milliseconds
                                        const eventDate = moment.tz(val.timestamp, undefined, timezone).valueOf();
                                            
                                        // save event as idlingAtOrigin if RULE_NAME consists "Inside" and "Idle" strings
                                        if(getIndexOf(val.RULE_NAME,["Inside","Idle"],"and") && !eventsCaptured[eventDate]){
                                            eventsCaptured[eventDate] = "idlingAtOrigin";
                                        }
                                        // save event as processingAtOrigin if RULE_NAME consists "Inside" and "Processing" strings
                                        if(getIndexOf(val.RULE_NAME,["Inside","Processing"],"and") && !eventsCaptured[eventDate]){
                                            eventsCaptured[eventDate] = "processingAtOrigin";
                                        }
                                        // save event as queueingAtOrigin if RULE_NAME consists "Inside" and "Queueing" strings
                                        if(getIndexOf(val.RULE_NAME,["Inside","Queueing"],"and") && !eventsCaptured[eventDate]){
                                            eventsCaptured[eventDate] = "queueingAtOrigin";
                                        }

                                        // save event as tempStatus for events that do not fall under idlingAtOrigin, processingAtOrigin, or queueingAtOrigin
                                        if(!eventsCaptured[eventDate]){
                                            eventsCaptured[eventDate] = "tempStatus";
                                        }
                                    }

                                    // sort eventsCaptured by key (timestamp/eventDate) in ascending order
                                    const sortedEvents = OBJECT.sortByKey(eventsCaptured);
                                    
                                    // change first status event to "entered_origin"
                                    // Note: "entered_origin" is just for reference when the truck entered the origin geofence. It is not a status.
                                    Object.keys(sortedEvents).forEach((key,i) => {
                                        (i == 0) ? sortedEvents[key] = "entered_origin" : null;
                                    });

                                    // loop to delete "tempStatus"
                                    Object.keys(sortedEvents).forEach(key => {
                                        (sortedEvents[key] == "tempStatus") ? delete sortedEvents[key] : null;
                                    });

                                    // had to loop again because when "tempStatus" is deleted, sortedEvents[lastTimestamp] ends up to be undefined
                                    const lastTimestamp = Object.keys(sortedEvents).map(key => { return Number(key); }).sort().reverse()[0];
                                
                                    // status is equal to the last timestamp's status value
                                    status = sortedEvents[lastTimestamp] || defaultStatus;
                                    
                                    return {
                                        status: (status == "entered_origin") ? defaultStatus : status,
                                        events: sortedEvents
                                    };
                                }

                                const set = { status: defaultStatus };

                                // get origin data
                                const origin = gDocs.find(x => x._id.toString() == eVal.origin_id.toString()) || {};
                                // get vehicle data
                                const vehicleHistory = vhDocs.find(x => x._id == eVal.vehicle_id) || {};
                                // get history location data of vehicle
                                const loc = vehicleHistory.location || [];
                                // get last location of vehicle
                                const lastLocation = loc[loc.length-1];
                                
                                // if last location is equal to shipment's origin
                                if(lastLocation.short_name == origin.short_name){
                                    const shipment = getStatusAndEvents(lastLocation.events);

                                    set[`events_captured`] = shipment.events;
                                    set[`history.${now_ms}`] = `Scheduled Dispatch - Status updated to <status>${shipment.status}</status>.`;
                                    set.status = shipment.status;
                                } else {
                                    set[`history.${now_ms}`] = `Scheduled Dispatch - Status updated to <status>${defaultStatus}</status>.`;
                                }

                                childPromise.push( dispatchCollection.updateOne({ _id: eVal._id },{ $set: set }) );
                            });

                            Promise.all(childPromise).then(() => {
                                isDone(clientName);
                            }).catch(error => {
                                isDone(clientName,"Promise",error);
                            });
                        });
                    });
                } else {
                    isDone(clientName);
                }
            }).catch(error => {
                isDone(clientName,"Dispatch Find",error);
            });
        }

        
        // will resolve the function depending if there was an error or not. Also, this will display the error if an error is passed
        // check if all CLIENTS[] are done
        function isDone(clientName,errTitle,err){ 
            
            // if error, display the title and error
            if(err) {
                console.log(`Error in ${errTitle}:`,err);
                hasError = true;
            }

            // when process() is done per client, changed value to true for checking later
            CLIENTS[clientName] = true;

            var allClientsAreDone = true;

            // check if all CLIENTS[] is equal to true
            Object.keys(CLIENTS).forEach(key => {
                if(CLIENTS[key] !== true) allClientsAreDone = false;
            });

            // if all clients are done, close mongodb client and resolve function
            if(allClientsAreDone === true){
                // close the mongodb client connection
                client.close();
                
                // return 
                res.status(hasError?500:200).send(hasError?"ERROR":"OK");
            }
        }
        /************** end Functions **************/


        /************** START OF PROCESS **************/
        // execute process() function for each CLIENTS element
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};