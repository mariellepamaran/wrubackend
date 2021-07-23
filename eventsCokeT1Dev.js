const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.eventsCokeT1Dev = (req, res) => {
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
            dbLogging = client.db(`${dbName}-logging`),
            eventsCollection = dbLogging.collection('events');
            
        console.log("Method:",method," | DateTime: ",moment(new Date()).format("MM/DD/YYYY hh:mm:ss A"));
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));
        console.log("Filtered:",`${query.GEOFENCE_NAME} - ${query.USER_NAME} (${query.USER_USERNAME})`);

        if(query.GEOFENCE_NAME){
            var date = (query.stage == "start") ? new Date(query["Event start time"]+"Z") : new Date(query["EVENT_TIME"]+"Z"),
                newObjectId = (query.RULE_NAME == "Inside Geofence") ? ObjectId() : null,
                insertedId = null,
                event = {
                    "Event Id": newObjectId,
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
                };
            
            var tries = 0;
            function saveEventsLogs(){
                eventsCollection.insertOne(event).then(result => {
                    insertedId = result.insertedId;
                    console.log("insertedId",insertedId);

                    try {
                        req.query.insertedId = insertedId;
                        var queryString = Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&');
                        request({
                            method: 'POST',
                            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/eventsCokeT1DevShipments?${queryString}`,
                            headers: {
                                "Content-Type": "application/json"
                            },
                            json: true,
                            body: {}
                        });
                    } catch (error){
                        console.log("Request Error",error);
                    }

                    try {
                        req.query.insertedId = insertedId;
                        req.query.newObjectId = newObjectId;
                        var queryString = Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&');
                        request({
                            method: 'POST',
                            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/eventsCokeT1DevCICO?${queryString}`,
                            headers: {
                                "Content-Type": "application/json"
                            },
                            json: true,
                            body: {}
                        });
                    } catch (error){
                        console.log("Request Error",error);
                    }

                    client.close();
                    res.status(200).send("OK");
                }).catch(error => {
                    console.log("Error saving logs",JSON.stringify(error));
                    if(tries < 5){
                        tries++;
                        saveEventsLogs();
                    } else {
                        client.close();
                        res.status(500).send('Error: Something went wrong.');
                    }
                });
            }
            saveEventsLogs();
        } else {
            client.close();
            res.status(500).send('Error: Invalid parameters.');
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};