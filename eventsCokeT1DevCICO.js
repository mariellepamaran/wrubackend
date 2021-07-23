const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const request = require('request');

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.eventsCokeT1DevCICO = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');


    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query;

        const dbName = "wd-coket1",
              client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
              db = client.db(`wd-${clientName}`),
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
                    checkInGeofenceName = getOriginalAddress(query["GEOFENCE_NAME"]);

                    // if Inside Geofence
                    //    - Send Check-In event
                    //    - get last Outside Geofence (of this vehicle) to fill the Check-Out event
                    //         > in eventsCollection
                    if(query["RULE_NAME"] == "Inside Geofence"){

                        eventsCollection.find({
                            USER_NAME: query.USER_NAME,
                            RULE_NAME: "Outside Geofence",
                            timestamp: {
                                $lt: eventTime.toISOString()
                            }
                        }).limit(1).toArray().then(eDocs => {
                            
                            var eDoc = eDocs[0];
                            var onDestinationGeofenceName = null;

                            var shortNames = [checkInGeofenceName];

                            if(eDoc){
                                onDestinationGeofenceName = getOriginalAddress(eDoc["GEOFENCE_NAME"]);
                                shortNames.push(onDestinationGeofenceName);
                            }

                            geofencesCollection.find({ short_name: { $in: shortNames } }).toArray().then(gDocs => {

                                /******* Check-In */
                                var checkInDuration = Math.abs(moment().diff(moment(eventStartTime), 'hours', true));
                                var ciGeofence = gDocs.find(x => x.short_name == checkInGeofenceName) || {};
                                var eventCheckIn = {
                                    "Event Id": newObjectId,
                                    "Event": "Check-In",
                                    "Vehicle": query["USER_NAME"],
                                    "Check In Date": moment(eventStartTime).format("MM/DD/YYYY"),
                                    "Check In Time": moment(eventStartTime).format("H:mm"),
                                    "Check Out Date": "",
                                    "Check Out Time": "",
                                    "Duration": ROUND_OFF(checkInDuration,1) + " h",
                                    "Site": checkInGeofenceName,
                                    "Site Code": ciGeofence.code || "",
                                    "Destination": "",
                                    "Site Code": "",
                                    "Truck Status": query["Availability"],
                                    "Equipt No": query["Equipment Number"],
                                    "Event State": "Pending",
                                    "Truck Base Site": query["Base Site"],
                                    "Truck Base Site Code": query["Base Site Code"]
                                };

                                
                                /******* On-Destination */
                                if(eDoc){
                                    var onDestinationDuration = Math.abs(moment(eDoc.timestamp).diff(moment(eventTime), 'hours', true));
                                    var odGeofence = gDocs.find(x => x.short_name == onDestinationGeofenceName) || {};
    
                                    var eventOnDestination = {
                                        "Event Id": eDoc["Event Id"],
                                        "Event": "On-Destination",
                                        "Vehicle": query["USER_NAME"],
                                        "Check In Date": moment(eDoc.timestamp).format("MM/DD/YYYY"),
                                        "Check In Time": moment(eDoc.timestamp).format("H:mm"),
                                        "Check Out Date": moment(eventTime).format("MM/DD/YYYY"),
                                        "Check Out Time":  moment(eventTime).format("H:mm"),
                                        "Duration": ROUND_OFF(onDestinationDuration,1) + " h",
                                        "Site": onDestinationGeofenceName,
                                        "Site Code": odGeofence.code || "",
                                        "Destination": checkInGeofenceName,
                                        "Site Code": ciGeofence.code || "",
                                        "Truck Status": query["Availability"],
                                        "Equipt No": query["Equipment Number"],
                                        "Event State": "Finished",
                                        "Truck Base Site": query["Base Site"],
                                        "Truck Base Site Code": query["Base Site Code"]
                                    };
                                } else {
                                    console.log("Error in Event (404): ",query.USER_NAME,eventTime);
                                }
                            }).catch(error => {
                                console.log("Error in Geofence (find).",error);
                                client.close();
                                res.status(500).send('Error in Geofence (find).');
                            });
                        }).catch(error => {
                            console.log("Error in Events (find).",error);
                            client.close();
                            res.status(500).send('Error in Events (find).');
                        });
                        
                    }

                    // IG
                    // events - check vehicle, timestamps < TIME, rule_name == OG
                    
            } else {
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