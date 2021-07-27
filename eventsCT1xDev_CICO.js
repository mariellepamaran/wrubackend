const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.eventsCT1xDev_CICO = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    const sendToApi = false;

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query;

        const dbName = "wd-coket1",
              client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
              db = client.db(dbName),
              dbLogging = client.db(`${dbName}-logging`),
              geofencesCollection = db.collection('geofences'),
              eventsCollection = dbLogging.collection('events');
            
        console.log("Method:",method," | DateTime: ",moment(new Date()).format("MM/DD/YYYY hh:mm:ss A"));
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));
        console.log("Filtered:",`${query.GEOFENCE_NAME} - ${query.USER_NAME} (${query.USER_USERNAME})`);

        function ROUND_OFF(value,decimal_place){
            decimal_place = (decimal_place != null) ? decimal_place : 2;
            return Number(Math.round((value)+`e${decimal_place}`)+`e-${decimal_place}`);
        }
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
            if((["Inside Geofence","Outside Geofence"].includes(query.RULE_NAME))){
                var eventTime = new Date(query["EVENT_TIME"]+"Z"),
                    eventStartTime = new Date(query["Event start time"]+"Z"),
                    newObjectId = query.newObjectId,
                    insertedId = query.insertedId,
                    currentGeofenceName = getOriginalAddress(query.GEOFENCE_NAME),
                    childPromise = [];

                    // if Inside Geofence
                    //    - Send Check-In event
                    //    - Update previous event - Add destination data
                    //         > get last Inside & Outside Geofence (of this vehicle) to fill the Check-In and Check-Out datetimes
                    //         > current geofence and time will be the --destination--
                    //         > in eventsCollection
                    if(query.RULE_NAME == "Inside Geofence"){

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
                            
                            var eInsideDoc = eDocs.find(x => x.RULE_NAME == "Inside Geofence") || {};
                            var eOutsideDoc = eDocs.find(x => x.RULE_NAME == "Outside Geofence") || {};

                            // since it's sorted in descending order, the last geofence or index 0 should be the Outside Geofence
                            // and index 1 should be the Inside Geofence. And take note that both should have the same Geofence Name
                            if( getOriginalAddress(eInsideDoc.GEOFENCE_NAME) == getOriginalAddress(eOutsideDoc.GEOFENCE_NAME) &&
                                (eDocs[0]||{}).RULE_NAME == "Outside Geofence" && (eDocs[1]||{}).RULE_NAME == "Inside Geofence" ){

                                var previousGeofenceName = getOriginalAddress(eInsideDoc.GEOFENCE_NAME);
                                var shortNames = [currentGeofenceName,previousGeofenceName];
    
                                geofencesCollection.find({ short_name: { $in: shortNames } }).toArray().then(gDocs => {
    
                                    /******* Check-In */
                                    var checkInDuration = Math.abs(moment().diff(moment(eventStartTime), 'hours', true));
                                    var cGeofence = gDocs.find(x => x.short_name == currentGeofenceName) || {};
                                    var eventCheckIn = {
                                        "Event Id": newObjectId || "",
                                        "Event": "Check-In",
                                        "Vehicle": query["USER_NAME"] || "",
                                        "Check In Date": moment(eventStartTime).format("MM/DD/YYYY"),
                                        "Check In Time": moment(eventStartTime).format("H:mm"),
                                        "Check Out Date": "",
                                        "Check Out Time": "",
                                        "Duration": ROUND_OFF(checkInDuration,1) + " h",
                                        "Site": currentGeofenceName,
                                        "Site Code": cGeofence.code || "",
                                        "Destination": "",
                                        "Destination Site Code": "",
                                        "Truck Status": query["Availability"] || "",
                                        "Equipt No": query["Equipment Number"] || "",
                                        "Event State": "Pending",
                                        "Truck Base Site": query["Base Site"] || "",
                                        "Truck Base Site Code": query["Base Site Code"] || ""
                                    };
    
                                    
                                    /******* On-Destination */
                                    var previousDuration = Math.abs(moment(eInsideDoc.timestamp).diff(moment(eOutsideDoc.timestamp), 'hours', true));
                                    var pGeofence = gDocs.find(x => x.short_name == previousGeofenceName) || {};
    
                                    var eventOnDestination = {
                                        "Event Id": eInsideDoc["Event Id"] || "",
                                        "Event": "On-Destination",
                                        "Vehicle": query["USER_NAME"] || "",
                                        "Check In Date": moment(eInsideDoc.timestamp).format("MM/DD/YYYY"),
                                        "Check In Time": moment(eInsideDoc.timestamp).format("H:mm"),
                                        "Check Out Date": moment(eOutsideDoc.timestamp).format("MM/DD/YYYY"),
                                        "Check Out Time":  moment(eOutsideDoc.timestamp).format("H:mm"),
                                        "Duration": ROUND_OFF(previousDuration,1) + " h",
                                        "Site": previousGeofenceName,
                                        "Site Code": pGeofence.code || "",
                                        "Destination": currentGeofenceName,
                                        "Destination Site Code": cGeofence.code || "",
                                        "Truck Status": query["Availability"] || "",
                                        "Equipt No": query["Equipment Number"] || "",
                                        "Event State": "Finished",
                                        "Truck Base Site": query["Base Site"] || "",
                                        "Truck Base Site Code": query["Base Site Code"] || ""
                                    };

                                    if(sendToApi){
                                        console.log("DONE (eventCheckIn)",JSON.stringify(eventCheckIn));
                                        // send event (Check-In) to third-party API
                                        var queryParams = Object.keys(eventCheckIn).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(eventCheckIn[k])}`).join('&');
                                        childPromise.push(request.get(`https://asfa-ccbp-lct-dev-01.azurewebsites.net/api/wrudispatch?code=xyR6Yfbc5cJboGcIkKyCTQswKvRDG3/hs3U00HGaI8h5bJQdUJoZag==&${queryParams}`));
    
                                        if(eInsideDoc["Event Id"]){
                                            console.log("DONE (eventOnDestination)",JSON.stringify(eventOnDestination));
                                            // send event (On-Destination) to third-party API
                                            var queryParams = Object.keys(eventOnDestination).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(eventOnDestination[k])}`).join('&');
                                            childPromise.push(request.get(`https://asfa-ccbp-lct-dev-01.azurewebsites.net/api/wrudispatch?code=xyR6Yfbc5cJboGcIkKyCTQswKvRDG3/hs3U00HGaI8h5bJQdUJoZag==&${queryParams}`));
                                        }
    
                                        Promise.all(childPromise).then(result => {
                                            client.close();
                                            res.status(200).send("OK");
                                        }).catch(error => {
                                            console.log("Error in Promise (check-in & on-destination).",error);
                                            client.close();
                                            res.status(500).send('Error in Promise (check-in & on-destination).');
                                        });
                                    } else {
                                        console.log("DONE (eventCheckIn)",JSON.stringify(eventCheckIn));
                                        console.log("DONE (eventOnDestination)",JSON.stringify(eventOnDestination));
                                        client.close();
                                        res.status(200).send("OK");
                                    }
                                }).catch(error => {
                                    console.log("Error in Geofence (find).",error);
                                    client.close();
                                    res.status(500).send('Error in Geofence (find).');
                                });
                            } else {
                                console.log("Error in sort/order", eDocs);
                                client.close();
                                res.status(200).send('Error in sort/order');
                            }
                        }).catch(error => {
                            console.log("Error in Events (find).",error);
                            client.close();
                            res.status(500).send('Error in Events (find).');
                        });
                        
                    }

                    // if Outside Geofence
                    //    - get last Inside Geofence (of this vehicle) to fill the Check-In datetimes
                    //         > current geofence and time will be the --checkout--
                    //         > in eventsCollection
                    else if(query.RULE_NAME == "Outside Geofence"){

                        eventsCollection.find({
                            USER_NAME: query.USER_NAME,
                            RULE_NAME: "Inside Geofence",
                            timestamp: {
                                $lt: eventTime.toISOString()
                            },
                            GEOFENCE_NAME: query.GEOFENCE_NAME
                        }).sort({_id:-1}).limit(1).toArray().then(eDocs => {

                            var eInsideDoc = eDocs.find(x => x.RULE_NAME == "Inside Geofence") || {};

                            if(getOriginalAddress(eInsideDoc.GEOFENCE_NAME) == currentGeofenceName){
                                geofencesCollection.find({ short_name: currentGeofenceName }).toArray().then(gDocs => {
    
                                    /******* Check-Out */
                                    var checkOutDuration = Math.abs(moment(eInsideDoc.timestamp).diff(moment(eventTime), 'hours', true));
                                    var cGeofence = gDocs.find(x => x.short_name == currentGeofenceName) || {};
                                    var eventCheckOut = {
                                        "Event Id": eInsideDoc["Event Id"] || "",
                                        "Event": "Check-Out",
                                        "Vehicle": query["USER_NAME"] || "",
                                        "Check In Date": moment(eInsideDoc.timestamp).format("MM/DD/YYYY"),
                                        "Check In Time": moment(eInsideDoc.timestamp).format("H:mm"),
                                        "Check Out Date": moment(eventTime).format("MM/DD/YYYY"),
                                        "Check Out Time": moment(eventTime).format("H:mm"),
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
                                            childPromise.push(request.get(`https://asfa-ccbp-lct-dev-01.azurewebsites.net/api/wrudispatch?code=xyR6Yfbc5cJboGcIkKyCTQswKvRDG3/hs3U00HGaI8h5bJQdUJoZag==&${queryParams}`));
                                        }

                                        // save "Event Id" of current event same as the last Inside Geofence event.
                                        childPromise.push(eventsCollection.updateOne({ _id: ObjectId(insertedId) }, { $set: { "Event Id": eInsideDoc["Event Id"] } }));

                                        Promise.all(childPromise).then(result => {
                                            client.close();
                                            res.status(200).send("OK");
                                        }).catch(error => {
                                            console.log("Error in Promise (check-out).",error);
                                            client.close();
                                            res.status(500).send('Error in Promise (check-out).');
                                        });
                                    } else {
                                        console.log("No Event Id");
                                        client.close();
                                        res.status(200).send("OK");
                                    }
                                }).catch(error => {
                                    client.close();
                                    console.log("Error in Geofence (find).",error);
                                    res.status(500).send('Error in Geofence (find).');
                                });
                            } else {
                                console.log("Error in Event (404): ",query.USER_NAME,eventTime,eDocs);
                                client.close();
                                res.status(500).send('Error in Event (404).');
                            }
                        }).catch(error => {
                            console.log("Error in Events (find).",error);
                            client.close();
                            res.status(500).send('Error in Events (find).');
                        });
                    } 

                    else {
                        client.close();
                        res.status(200).send("OK");
                    }
            } else {
                client.close();
                res.status(200).send("OK");
            }
        } else {
            client.close();
            res.status(500).send('Error: Invalid parameters.');
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};