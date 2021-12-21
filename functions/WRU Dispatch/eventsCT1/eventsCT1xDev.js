/**
 * eventsCT1
 * 
 * >> This function's main goal is to save the event data to the database <<
 * 
 * This function also updates the last seen timestamp of the vehicle and calls necessary functions
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

// PRODUCTION
// const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.eventsCT1xDev = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // declare event urls
    const eventShipmentURL = "https://asia-east2-secure-unison-275408.cloudfunctions.net/eventsCT1xDev_Shipments";
    const eventCICOURL = "https://asia-east2-secure-unison-275408.cloudfunctions.net/eventsCT1xDev_CICO";

    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const now = moment.tz(undefined, undefined, timezone); // get current time

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });
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
        const dbName = "coket1";

        const dbLogging = client.db(`wd-${dbName}-logging`);
        const eventsCollection = dbLogging.collection('events');

        const otherDb = client.db(dbName);
        const vehiclesCollection = otherDb.collection('vehicles');

        // date and time variables (moment)
        const startTime = moment.tz(query["Event start time"]+"Z", undefined, timezone).toISOString();
        const eventTime = moment.tz(query["EVENT_TIME"]+"Z", undefined, timezone).toISOString();
        const finalTime = (query.stage == "start") ? startTime : eventTime;

        // make sure that GEOFENCE_NAME exists
        if(query.GEOFENCE_NAME){
            // create new ObjectId()
            const newObjectId = (query.RULE_NAME == "Inside Geofence") ? ObjectId() : null;

            // event object to be saved in database
            const event = {
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
                timestamp: finalTime
            };
            
            // exectute Promise.all() method
            Promise.all([
                // insert event to database
                eventsCollection.insertOne(event),
                // update the last seen timestamp of the vehicle
                vehiclesCollection.updateOne( { _id: Number(query.ASSIGNED_VEHICLE_ID) }, { $set: { last_seen: finalTime } } )
            ]).then(result => {
                // get first(0) element of the result because we need to get the insertedId from "eventsCollection.insertOne(event)"
                const insertedId = result[0].insertedId;

                // print insertedId and newObjectId for debugging purposes
                console.log("insertedId",insertedId);
                console.log("newObjectId",newObjectId);

                // Call Shipment function
                try {
                    // add 'insertedId' to query to send to Shipment function
                    req.query.insertedId = insertedId;
                    // convert object to url parameter string
                    const queryString = Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&');
                    request({
                        method: 'GET',
                        url: `${eventShipmentURL}?${queryString}`,
                    });
                } catch (error){
                    console.log("Request Error",error);
                }

                // Call CICO function
                try {
                    // add 'insertedId' to query to send to CICO function
                    req.query.insertedId = insertedId;
                    // add 'newObjectId' to query to send to CICO function
                    req.query.newObjectId = newObjectId;
                    // convert object to url parameter string
                    const queryString = Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&');
                    request({
                        method: 'GET',
                        url: `${eventCICOURL}?${queryString}`,
                    });
                } catch (error){
                    console.log("Request Error",error);
                }

                // close the mongodb client connection
                client.close();
    
                // return success
                res.status(200).send("OK");
                
            }).catch(error => {
                // print error
                console.log("Error in Promise",error);
    
                // close the mongodb client connection
                client.close();
    
                // return error
                res.status(500).send('Error in Promise: ', JSON.stringify(error));
            });
        } else {
            // print error
            console.log('Error: Invalid parameters.');

            // close the mongodb client connection
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