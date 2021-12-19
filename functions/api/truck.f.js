/**
 * truck
 * 
 * >> Retrieve vehicle data by Plate Number <<
 * 
 * specifically made for Sir Binky
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

const clientApplicationId = {
    "9":    "wd-coket1",
    "4":    "wd-coket2",
    "14":   "wd-fleet",
    "427":  "wd-wilcon",
};

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {
        // url parameters
        const params = req.params[0];
        const params_value = params.split("/").filter(x => x);

        // .../<APP_ID>/<Identifier>/<Value>
        // fields from url params
        const appId = params_value[0];
        const identifier = params_value[1];
        const value = params_value[2];

        console.log("params_value",params_value);

        // get client db name by appId
        const clientName = clientApplicationId[appId];
            
        if(clientName){
            if(['Plate Number','IMEI'].includes(identifier)){
                if(value){
                    // initialize mongoDb Client
                    const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });
            
                    // initialize database
                    const db = client.db(clientName);
                    const vehiclesCollection = db.collection('vehicles');
                  
                    // query based on identifier
                    var query = { name: value.toUpperCase() };
                    (identifier == 'Plate Number') ? query = { name: value.toUpperCase() } : null;
                    (identifier == 'IMEI') ? query = { 'devices.imei': value } : null;

                    // retrieve vehicle by Plate Number
                    vehiclesCollection.find(query).toArray().then(docs => {
                        const doc = docs[0];
                        if(doc){
                            // close the mongodb client connection
                            client.close();
                            
                            // return success status and data needed by Sir Binky
                            res.status(200).send({
                                ok: 1,
                                data: {
                                    "id": doc._id,
                                    "Pal Cap": doc["Pal Cap"],
                                    "Trailer": doc["Trailer"],
                                    "Availability": doc["Availability"],
                                    "Tractor Conduction": doc["Tractor Conduction"],
                                    "Plate Number": doc["Plate Number"] || doc["name"]
                                }
                            });
                        } else {
                            // close the mongodb client connection
                            client.close();
    
                            // return error with message
                            res.status(500).send({
                                error: 1,
                                message: identifier + " does not exist."
                            });
                        }
                    });
                } else {
                    // return error with message
                    res.status(500).send({
                        error: 1,
                        message: "Missing query parameter/s."
                    });
                }
            } else if(['All'].includes(identifier)){
                // initialize mongoDb Client
                const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });
        
                // initialize database
                const db = client.db(clientName);
                const vehiclesCollection = db.collection('vehicles');
            
                // retrieve all vehicles
                vehiclesCollection.find({}).toArray().then(docs => {

                    const vehiclesArr = [];

                    // loop returned vehicle list
                    docs.forEach(val => {

                        // get the IMEI of devices
                        const device = (val.devices||[])[0] || {};
                        
                        // push data to array
                        vehiclesArr.push({
                            "id": val._id,
                            "Plate Number": val["Plate Number"] || val["name"],
                            "Device ID": device.id || "",
                            "IMEI": device.imei || "",
                        });
                    });

                    // close the mongodb client connection
                    client.close();
                    // return success status and data needed by Sir Binky
                    res.status(200).send({
                        ok: 1,
                        data: vehiclesArr
                    });
                });
            } else {
                // return error with message
                res.status(500).send({
                    error: 1,
                    message: "Invalid identifier."
                });
            }
        } else {
            // return error with message
            res.status(500).send({
                error: 1,
                message: "Invalid appId."
            });
        }
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});