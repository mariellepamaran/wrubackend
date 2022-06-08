/**
 * incompleteShipment
 * 
 * >> Update entries' status to Incomplete if conditions are met <<
 * 
 * 1st condition: Transit time > Route's target transit time + 12 hours
 * 2nd condition: No changes in status for 7 days or more
 *                  > status that is NOT Plan, In Transit, Complete, or Incomplete
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const request = require('request');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.incompleteShipment = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/incompleteShipmentxDev` }); } 
    catch (error){ console.log("Request Error",error); }

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
        const nowMs = now.valueOf(); // get current time in milliseconds

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            // "wd-coket1":null,
            // "wd-coket2":null,
            "wd-wilcon":null,
            "wd-orient_freight":null,
        };

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        // Tags In Transit entries to Incomplete (if: Transit time > Route's target transit time + 12 hours)
        function processInTransit (clientName){
            // initialize database
            const db = client.db(clientName);
            const dispatchCollection = db.collection('dispatch');

            // retrieve dispatch entries that are In Transit. Get each entry's corresponding route.
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
                { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
            ]).toArray().then(docs => {

                // store here the IDs of entries that should be tagged as Incomplete
                const _ids = [];

                docs.forEach(val => {

                    // if route exists
                    if(val.route){
                        // set default values for field so they're not null or undefined
                        val.destination = val.destination || [];

                        // if departure_date exists
                        if(val.departure_date) {
                            // get the millisecond version of the departure date (or on delivery time)
                            const departureDateTimestamp = moment.tz(val.departure_date, undefined, timezone).valueOf();

                            // get transit time in decimal hour
                            const transit_dh = (((nowMs - departureDateTimestamp)/3600)/1000);
                            
                            // get the leeway time. (Route's target transit time + 12 hours)
                            const leeway = Number(val.route.transit_time) + 12;

                            console.log("_id",val._id,"transitDH",transit_dh,"leeway",leeway);

                            // if transit time is greater than the leeway time, tag shipment as Incomplete
                            if(transit_dh > leeway){
                                _ids.push(val._id);
                            }
                        }
                    } else {
                        // if shipment's route does not exist, tag shipment as Incomplete
                        _ids.push(val._id);
                    }
                });
                console.log("_ids",JSON.stringify(_ids));
    
                if(_ids.length > 0){
                    // set the fields of entries which will be updated
                    const set = { status: "incomplete" };
                    set[`events_captured.${nowMs}`] = "incomplete";
                    set[`history.${nowMs}`] = `System - Status updated to <status>incomplete</status>.`;

                    // update the entries' status to Incomplete
                    dispatchCollection.updateMany({ _id: { $in: _ids } }, { $set: set }).then(() => {
                        // proceed to checking on delivery shipments
                        processOnDelivery(clientName);
                    }).catch(error => {
                        isDone(clientName,"Dispatch Entry (Update) (In Transit)",error);
                    });
                } else {
                    // proceed to checking on delivery shipments
                    processOnDelivery(clientName);
                }
            }).catch(error => {
                isDone(clientName,"Dispatch Entry (Aggregate) (In Transit)",error);
            });
        }

        // Tags On Delivery entries to Incomplete (if: assigned truck didn’t meet the logic of "Complete" status within 36hrs)
        function processOnDelivery (clientName){
            // initialize database
            const db = client.db(clientName);
            const dispatchCollection = db.collection('dispatch');

            // retrieve dispatch entries that are On Delivery. Get each entry's corresponding route.
            dispatchCollection.aggregate([
                {
                    $match: { status: "onDelivery" }
                },
            ]).toArray().then(docs => {

                // store here the IDs of entries that should be tagged as Incomplete
                const _ids = [];

                docs.forEach(val => {
                    // if departure_date exists
                    if(val.departure_date) {
                        // get the millisecond version of the departure date (or on delivery time)
                        const departureDateTimestamp = moment.tz(val.departure_date, undefined, timezone).valueOf();
    
                        // get transit time in decimal hour
                        const transit_dh = (((nowMs - departureDateTimestamp)/3600)/1000);
                        
                        console.log("_id",val._id,"transitDH",transit_dh);

                        // if transit time is greater than 36 hours, tag shipment as Incomplete
                        // As per Coke, "... when the assigned truck didn’t meet the logic of "Complete" status within 36hrs"
                        if(transit_dh > 36){
                            _ids.push(val._id);
                        }
                    }
                });
                console.log("_ids",JSON.stringify(_ids));
    
                if(_ids.length > 0){
                    // set the fields of entries which will be updated
                    const set = { status: "incomplete" };
                    set[`events_captured.${nowMs}`] = "incomplete";
                    set[`history.${nowMs}`] = `System - Status updated to <status>incomplete</status>.`;

                    // update the entries' status to Incomplete
                    dispatchCollection.updateMany({ _id: { $in: _ids } }, { $set: set }).then(() => {
                        // proceed to checking other shipments
                        processOtherStatus(clientName);
                    }).catch(error => {
                        isDone(clientName,"Dispatch Entry (Update) (On Delivery)",error);
                    });
                } else {
                    // proceed to checking other shipments
                    processOtherStatus(clientName);
                }
            }).catch(error => {
                isDone(clientName,"Dispatch Entry (Aggregate) (On Delivery)",error);
            });
        }
        
        // Tags entries ith *status to Incomplete (if: No changes in status for 7 days or more)
        // *status that is NOT Plan, In Transit, Complete, or Incomplete
        function processOtherStatus(clientName){
            // initialize database
            const db = client.db(clientName);
            const dispatchCollection = db.collection('dispatch');

            // retrieve entries where status is NOT Plan, In Transit, Complete, or Incomplete
            dispatchCollection.aggregate([
                {
                    $match: { 
                        status: {
                            // note: added "dispatched","onDelivery" because CokeT2 has a different logic for incomplete shipments
                            $nin: ["plan","in_transit","complete","incomplete", "dispatched","onDelivery"]
                        }
                    }
                },
            ]).toArray().then(docs => {

                // store here the IDs of entries that should be tagged as Incomplete
                const _ids = [];

                docs.forEach(val => {
                    // add 7 days to entry's posting date
                    const _7daysFromPostingDate = moment.tz(val.posting_date, undefined, timezone).add(7, 'days').valueOf();

                    // if today exceeds the "posting date + 7 days", tag shipment as Incomplete
                    if(nowMs >= _7daysFromPostingDate){
                        _ids.push(val._id);
                    }
                });
                console.log("_ids",JSON.stringify(_ids));
    
                if(_ids.length > 0){
                    // set the fields of entries which will be updated
                    const set = { status: "incomplete" };
                    set[`events_captured.${nowMs}`] = "incomplete";
                    set[`history.${nowMs}`] = `System - Status updated to <status>incomplete</status>.`;
                    
                    // update the entries' status to Incomplete
                    dispatchCollection.updateMany({ _id: { $in: _ids } }, { $set: set }).then(() => {
                        isDone(clientName);
                    }).catch(error => {
                        isDone(clientName,"Dispatch Entry (Update) (Other Status)",error);
                    });
                } else {
                    isDone(clientName);
                }
            }).catch(error => {
                isDone(clientName,"Dispatch Entry (Aggregate) (Other Status)",error);
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
            processInTransit(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};