/**
 * eventsCT1_CICO
 * 
 * >> Send CICO data to Coke everytime WD receives an event <<
 * 
 * Coke provided a url for us to send the data
 * In this function, there will be 3 event types for actual event:
 * Check-In – The truck entered the Site.
 * Check-Out – The truck left the Site.
 * On-Destination – The truck reached the Destination Site.
 * 
 * For refence: INSERT LINK HERE
 * 
 * 
 * Take note that the On-Destination event is for the previous event where current event's geofence is its destination
 * 
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.eventsCT1_CICO = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // for development purposes (value is FALSE), everytime the function is called, data will not send to Coke.
    // for production (value is TRUE), data will send to Coke API
    const sendToApi = true;
    // declare event urls
    const cokeApi = "https://asfa-ccbp-lct-dev-01.azurewebsites.net/api/wruCICO?code=43pvyGcwlahcCBwaA/qNjKaTUt45dq63ahkElJQGtEzXnR03I6X1qA==";

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
        const dbName = "wd-coket1",
        const db = client.db(dbName);
        const dbLogging = client.db(`${dbName}-logging`);
        const geofencesCollection = db.collection('geofences');
        const eventsCollection = dbLogging.collection('events');
            

        // function that rounds off a number
        function ROUND_OFF(value,decimal_place){
            decimal_place = (decimal_place != null) ? decimal_place : 2;
            return Number(Math.round((value)+`e${decimal_place}`)+`e-${decimal_place}`);
        }

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
            // only send data for events listed in the array
            if((["Inside Geofence","Outside Geofence"].includes(query.RULE_NAME))){
                // date and time variables (moment)
                const startTime = moment.tz(query["Event start time"]+"Z", undefined, timezone);
                const eventTime = moment.tz(query["EVENT_TIME"]+"Z", undefined, timezone);

                // generated ObjectId
                const newObjectId = query.newObjectId;

                // ID of the inserted Event
                const insertedId = query.insertedId;

                const currentGeofenceName = getOriginalAddress(query.GEOFENCE_NAME);

                // if Inside Geofence
                //    - Send Check-In event
                //    - Update previous event - Add destination data
                //         > get last Inside & Outside Geofence (of this vehicle) to fill the Check-In and Check-Out datetimes
                //         > current geofence and time will be the --destination--
                //         > in eventsCollection
                if(query.RULE_NAME == "Inside Geofence"){

                    // retreive events with filtered by _id, user_name, rule_name, and timestamp
                    // note: .sort({_id:-1}) - is to sort the result in descending order
                    //        limit result to only two (2)
                    eventsCollection.find({
                        _id: { 
                            $ne: ObjectId(insertedId) 
                        },
                        USER_NAME: query.USER_NAME,
                        RULE_NAME: { $in: ["Inside Geofence","Outside Geofence"] },
                        timestamp: {
                            $lt: eventTime.toISOString()
                        },
                    }).sort({_id:-1}).limit(2).toArray().then(eDocs => {
                        
                        // get event where RULE_NAME is "Inside Geofence"
                        const eInsideDoc = eDocs.find(x => x.RULE_NAME == "Inside Geofence") || {};

                        // get event where RULE_NAME is "Outside Geofence"
                        const eOutsideDoc = eDocs.find(x => x.RULE_NAME == "Outside Geofence") || {};

                        // since it's sorted in descending order, the last geofence or index 0 should be the Outside Geofence
                        // and index 1 should be the Inside Geofence. And take note that both should have the same Geofence Name
                        if( getOriginalAddress(eInsideDoc.GEOFENCE_NAME) == getOriginalAddress(eOutsideDoc.GEOFENCE_NAME) &&
                            (eDocs[0]||{}).RULE_NAME == "Outside Geofence" && (eDocs[1]||{}).RULE_NAME == "Inside Geofence" ){

                            // get the geofence name without the extensions like - Queueing, Processing, or Idling
                            const previousGeofenceName = getOriginalAddress(eInsideDoc.GEOFENCE_NAME);

                            // array of shortnames
                            const shortNames = [ currentGeofenceName, previousGeofenceName ];

                            // retrieve geofence data of the shortnames in array
                            geofencesCollection.find({ short_name: { $in: shortNames } }).toArray().then(gDocs => {

                                /******* Check-In */
                                // get the duration from current time to startTime
                                const checkInDuration = Math.abs(moment().diff(startTime, 'hours', true));
                                // get the geofence data for current geofence
                                const cGeofence = gDocs.find(x => x.short_name == currentGeofenceName) || {};

                                // object to be sent to Coke
                                const eventCheckIn = {
                                    "Event Id": newObjectId || "",
                                    "Event": "Check-In",
                                    "Vehicle": query["USER_NAME"] || "",
                                    "Check In Date": startTime.format("MM/DD/YYYY"),
                                    "Check In Time": startTime.format("H:mm"),
                                    "Check Out Date": "", // empty – Check Out Date is unknown
                                    "Check Out Time": "", // empty – Check Out Time is unknown
                                    "Duration": ROUND_OFF(checkInDuration,1) + " h",
                                    "Site": currentGeofenceName,
                                    "Site Code": cGeofence.code || "",
                                    "Destination": "", // empty – Destination is unknown
                                    "Destination Site Code": "", // empty – Destination Site Code is unknown
                                    "Truck Status": query["Availability"] || "",
                                    "Equipt No": query["Equipment Number"] || "",
                                    "Event State": "Pending", // still Pending
                                    "Truck Base Site": query["Base Site"] || "",
                                    "Truck Base Site Code": query["Base Site Code"] || ""
                                };

                                
                                /******* On-Destination */
                                // get the duration from time inside the geofence to outside geofence
                                const previousDuration = Math.abs(moment(eInsideDoc.timestamp).diff(moment(eOutsideDoc.timestamp), 'hours', true));
                                // get the geofence data for previous geofence
                                const pGeofence = gDocs.find(x => x.short_name == previousGeofenceName) || {};

                                // object to be sent to Coke
                                const eventOnDestination = {
                                    "Event Id": eInsideDoc["Event Id"] || "",
                                    "Event": "On-Destination",
                                    "Vehicle": query["USER_NAME"] || "",
                                    "Check In Date": moment(eInsideDoc.timestamp).format("MM/DD/YYYY"),
                                    "Check In Time": moment(eInsideDoc.timestamp).format("H:mm"),
                                    "Check Out Date": moment(eOutsideDoc.timestamp).format("MM/DD/YYYY"), // Check Out Date is filled
                                    "Check Out Time":  moment(eOutsideDoc.timestamp).format("H:mm"), // Check Out Time is filled
                                    "Duration": ROUND_OFF(previousDuration,1) + " h", // Duration is updated
                                    "Site": previousGeofenceName,
                                    "Site Code": pGeofence.code || "",
                                    "Destination": currentGeofenceName, // Destination is filled
                                    "Destination Site Code": cGeofence.code || "", // Destination Site Code is filled
                                    "Truck Status": query["Availability"] || "",
                                    "Equipt No": query["Equipment Number"] || "",
                                    "Event State": "Finished",
                                    "Truck Base Site": query["Base Site"] || "",
                                    "Truck Base Site Code": query["Base Site Code"] || ""
                                };

                                // check if this function is supposed to send the data to Coke
                                if(sendToApi){
                                    // print data for debugging
                                    console.log("DONE (eventCheckIn)",JSON.stringify(eventCheckIn));

                                    // convert object to url parameter string
                                    var queryParams = Object.keys(eventCheckIn).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(eventCheckIn[k])}`).join('&');
                                    // add promise to array -- send event (Check-In) to third-party API
                                    childPromise.push(request.get(`${cokeApi}&${queryParams}`));

                                    // if the 'eInsideDoc' has an Event Id, send the destination event
                                    if(eInsideDoc["Event Id"]){
                                        // print data for debugging
                                        console.log("DONE (eventOnDestination)",JSON.stringify(eventOnDestination));
                                        
                                        // convert object to url parameter string
                                        var queryParams = Object.keys(eventOnDestination).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(eventOnDestination[k])}`).join('&');
                                        // add promise to array -- send event (On-Destination) to third-party API
                                        childPromise.push(request.get(`${cokeApi}&${queryParams}`));
                                    }

                                    // promise
                                    Promise.all(childPromise).then(result => {
                                        isDone();
                                    }).catch(error => {
                                        isDone("Promise (check-in & on-destination)",error);
                                    });
                                } else {
                                    // print data for debugging
                                    console.log("DONE (eventCheckIn)",JSON.stringify(eventCheckIn));
                                    console.log("DONE (eventOnDestination)",JSON.stringify(eventOnDestination));
                                    isDone();
                                }
                            }).catch(error => {
                                isDone("Geofence (find)",error);
                            });
                        } else {
                            isDone("sort/order",eDocs);
                        }
                    }).catch(error => {
                        isDone("Events (find)",error);
                    });
                    
                }

                // if Outside Geofence
                //    - get last Inside Geofence (of this vehicle) to fill the Check-In datetimes
                //         > current geofence and time will be the --checkout--
                //         > in eventsCollection
                else if(query.RULE_NAME == "Outside Geofence"){

                    // retrieve events where RULE_NAME is Inside Geofence
                    // Meaning, current event's truck already left the geofence.
                    eventsCollection.find({
                        USER_NAME: query.USER_NAME,
                        RULE_NAME: "Inside Geofence",
                        timestamp: {
                            $lt: eventTime.toISOString()
                        },
                        GEOFENCE_NAME: query.GEOFENCE_NAME
                    }).sort({_id:-1}).limit(1).toArray().then(eDocs => {

                        // get event data where RULE_NAME is "Inside Geofence"
                        var eInsideDoc = eDocs.find(x => x.RULE_NAME == "Inside Geofence") || {};

                        if(getOriginalAddress(eInsideDoc.GEOFENCE_NAME) == currentGeofenceName){

                            // retrieve geofence data where short_name is event's geofence name
                            geofencesCollection.find({ short_name: currentGeofenceName }).toArray().then(gDocs => {

                                /******* Check-Out */
                                // get the duration from time inside the geofence to current time (outside geofence)
                                const checkOutDuration = Math.abs(moment(eInsideDoc.timestamp).diff(eventTime, 'hours', true));
                                // get the geofence data for current geofence
                                const cGeofence = gDocs.find(x => x.short_name == currentGeofenceName) || {};
                                
                                // object to be sent to Coke
                                const eventCheckOut = {
                                    "Event Id": eInsideDoc["Event Id"] || "",
                                    "Event": "Check-Out",
                                    "Vehicle": query["USER_NAME"] || "",
                                    "Check In Date": moment(eInsideDoc.timestamp).format("MM/DD/YYYY"),
                                    "Check In Time": moment(eInsideDoc.timestamp).format("H:mm"),
                                    "Check Out Date": eventTime.format("MM/DD/YYYY"),
                                    "Check Out Time": eventTime.format("H:mm"),
                                    "Duration": ROUND_OFF(checkOutDuration,1) + " h",
                                    "Site": currentGeofenceName,
                                    "Site Code": cGeofence.code || "",
                                    "Destination": "",
                                    "Destination Site Code": "",
                                    "Truck Status": query["Availability"] || "",
                                    "Equipt No": query["Equipment Number"] || "",
                                    "Event State": "Finished",
                                    "Truck Base Site": query["Base Site"] || "",
                                    "Truck Base Site Code": query["Base Site Code"] || ""
                                };
                                
                                if(eInsideDoc["Event Id"]){
                                    // send event to third-party API
                                    console.log("DONE (eventCheckOut)",JSON.stringify(eventCheckOut));
                                    if(sendToApi){
                                        var queryParams = Object.keys(eventCheckOut).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(eventCheckOut[k])}`).join('&');
                                        childPromise.push(request.get(`${cokeApi}&${queryParams}`));
                                    }

                                    // save "Event Id" of current event same as the last Inside Geofence event.
                                    childPromise.push(eventsCollection.updateOne({ _id: ObjectId(insertedId) }, { $set: { "Event Id": eInsideDoc["Event Id"] } }));

                                    Promise.all(childPromise).then(result => {
                                        isDone();
                                    }).catch(error => {
                                        isDone("Promise (check-out)",error);
                                    });
                                } else {
                                    console.log("No Event Id");
                                    isDone();
                                }
                            }).catch(error => {
                                isDone("Geofence (find)",error);
                            });
                        } else {
                            isDone("Event (404)", { USER_NAME: query.USER_NAME, eventTime, eDocs });
                        }
                    }).catch(error => {
                        isDone("Events (find)",error);
                    });
                } 

                else {
                    isDone();
                }
            } else {
                isDone();
            }

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
};