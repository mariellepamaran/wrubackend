/**
 * overspeedingEventsFleet
 * 
 * >> This function's main goal is to save the overspeeding event data to the database <<
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');
const request = require('request');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.overspeedingEventsFleet = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // call the development version of this function
    try {
        request({
            method: 'POST',
            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/overspeedingEventsFleetxDev`,
            headers : {
                "content-type": "application/json",
            },
            body: req.body,
            json: true
        });
    } catch (error){
        console.log("Request Error",error);
    }

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
        
        // initialize database
        const dbName = "wd-fleet";
        const dbLogging = client.db(`${dbName}-logging`);
        const eventsCollection = dbLogging.collection('events');
        
        // make sure that id exists
        if(body.id){

            // add timestamp received
            body.timestamp =  moment.tz(body.utc, undefined, timezone).toISOString();
            delete body.utc;

            // parse 'Value'
            try {
                body['Value'] = JSON.parse('{'+body['Value']+'}');

                // convert Dates to ISO
                body['Value']['Event Start'] ? body['Value']['Event Start'] = moment.tz(body['Value']['Event Start']+'Z', undefined, timezone).toISOString() : null;
                body['Value']['Check Out'] ? body['Value']['Check Out'] = moment.tz(body['Value']['Check Out']+'Z', undefined, timezone).toISOString() : null;
            } catch(error) {
                console.log('Error parsing',error);
            }
            
            // // exectute Promise.all() method
            Promise.all([
                // insert event to database
                eventsCollection.insertOne(body),
            ]).then(result => {
                // get first(0) element of the result because we need to get the insertedId from "eventsCollection.insertOne(event)"
                const insertedId = result[0].insertedId;

                // print insertedId and newObjectId for debugging purposes
                console.log("insertedId",insertedId);

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
                res.status(500).send('Error in Promise: '+ JSON.stringify(error));
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