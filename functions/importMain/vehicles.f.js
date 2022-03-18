/**
 * vehicles
 * 
 * >> Request vehicle data from WRU Main and save to WRU database <<
 * 
 * This function will request a specific size of data from WRU Main and save to WRU database
 * This function will repeat the process to get changes made from WRU Main
 * 
 * Links for testing ( Note: Any changes made in the test links will also affect the live data. So it's better to test only the GET functions )
 * Coke - http://coca-cola.server93.com/comGpsGate/api/v.1/test
 * Wilcon - http://wru.server93.com/comGpsGate/api/v.1/test
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const request = require('request');

// global variable
// will store from what last page index this function requested from WRU Main. This will then be used 
// to continue the request for the next X number of data. 
// Page Index will reset to 0 if the function already reached the last data from WRU Main
const pageIndexClient = {
    "coket1": 0,
    "coket1|fromT2": 0,
    "coket2": 0,
    "fleet":  0,
    "wilcon": 0,
    "pldt": 0,
    "cemex": 0,
};

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '256MB' }).https.onRequest((req, res) => {

    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/importMainVehiclesxDev` }); } 
    catch (error){ console.log("Request Error",error); }

    // the maximum number of data to be requested from WRU Main
    const pageSize = 300;

    console.log("pageIndexClient",pageIndexClient," | pageSize",pageSize);

    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }, { useNewUrlParser: true }, { connectTimeoutMS: 30000 }, { keepAlive: 1});

        // list of clients. Key is usually the db name
        const CLIENTS = {
            "coket1": null,
            "coket1|fromT2": null,
            "coket2": null,
            "fleet":  null,
            "wilcon": null,
            // "pldt": null,
            "cemex": null,
        };

        // CEMEX custom save
        const CUSTOMSAVE = {
            'cemex': ( _set ) => {

                const newSet = {};

                // for Trucker with value CEMEX, save 2nd word.
                // Ex. 'CEMEX D2Q027' --> 'D2Q027'
                if(_set['Trucker'] == 'CEMEX') {
                    const splitName =  _set['name'].split(' ');
                    newSet['name'] = splitName[1] || splitName[0];
                }

                return newSet;
            }
        }
        const CLIENT_OPTIONS = {
            // "coket1|fromT2" - we are getting other info from CokeT2 (base T1 on TagId)
            "coket1": {           ggsURL: "coca-cola.server93.com",    appId: 9,      username: "wru_marielle",    password: "467388",           tagId: null,    customfields: ["Trailer","Tractor Conduction","Base Site Code","Base Site","Equipment Number","Availability","Pal Cap","Site","Site Code"]                     },
            "coket1|fromT2": {    ggsURL: "coca-cola.server93.com",    appId: 4,      username: "wru_marielle",    password: "467388",           tagId: 630,     customfields: ["Offline Remark"]    }, // TagId: "ALL T1"
            "coket2": {           ggsURL: "coca-cola.server93.com",    appId: 4,      username: "wru_marielle",    password: "467388",           tagId: 27,      customfields: ["Trailer","Tractor Conduction","Base Site Code","Base Site","Equipment Number","Availability","Pal Cap","Site","Site Code","Offline Remark"]    }, // TagId: "ALL T2"
            "fleet":  {           ggsURL: "coca-cola.server93.com",    appId: 14,     username: "wru_marielle",    password: "467388",           tagId: null,    customfields: ["CN1","CN2","Fuel Capacity","Truck Model"]                                                                                                      },
            "wilcon": {           ggsURL: "wru.server93.com",          appId: 427,    username: "wru_marielle",    password: "ilovecats",        tagId: 8634,    customfields: ["Truck Number","Plate Number"]                                                                                                                  }, // TagID: "ALL"
            "pldt": {             ggsURL: "pldt.server93.com",         appId: 208,    username: "wru_dev",         password: "iwanttomukbang",   tagId: null,    customfields: []                                                                                                                  },
            "cemex": {            ggsURL: "wru.server93.com",          appId: 449,    username: "wru_dev",         password: "wplof4521amc",     tagId: null,    customfields: ["Trucker", "Driver Name"], customSave: CUSTOMSAVE['cemex']                                                                                                                  },
        };

        var hasError = false; // check if there were error/s during process(). 
                                // the reason for this is to send status 500 after all CLIENTS are done 
                                // instead of returning error immediately while other CLIENTS (if available) 
                                // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function implement(clientName){
            // initialize database
            const dbName = clientName.split("|")[0];
            const db = client.db(dbName);
            const vehiclesCollection = db.collection('vehicles');

            // get Main credentials
            const ggsURL = CLIENT_OPTIONS[clientName].ggsURL;
            const appId = CLIENT_OPTIONS[clientName].appId;
            const tagId = CLIENT_OPTIONS[clientName].tagId;
            const username = CLIENT_OPTIONS[clientName].username;
            const password = CLIENT_OPTIONS[clientName].password;

            // get user's token (to be used to request data from WRU Main)
            request({
                method: 'POST',
                url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tokens`,
                headers: {
                    "Content-Type": "application/json"
                },
                json: true,
                body: { username, password }
            }, (error, response, body) => {

                // if no error and status code is 200 (OK)
                if (!error && (response||{}).statusCode == 200) {

                    // store token
                    const token = body.token;

                    // array of promises
                    const childPromise = [];

                    // request URL for clients with Tag ID is different
                    // because WD only saves data from that specific Tag ID
                    // Note that we retrieve vehicles from 'users' function. I don't know why but that's how WRU Main works.
                    const url = (tagId) ? 
                                `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tags/${tagId}/users?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}` : 
                                `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/users?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`;

                    // request vehicles data from WRU Main
                    request({
                        url,
                        headers: {
                            'Authorization': token
                        }
                    }, (error, response, body) => {

                        // if no error and status code is 200 (OK)
                        if (!error && (response||{}).statusCode == 200) {

                            // convert the response body to JSON object
                            const vehicles = JSON.parse(body);

                            // "cf" is short for "Custom Field".
                            var cf_count = 0;

                            function isDoneProcessingVehicle(){
                                cf_count ++;

                                if(vehicles.length == cf_count){
                                    if(childPromise.length > 0){
                                        Promise.all(childPromise).then(docs => {
                                            isDone(clientName);
                                        }).catch(error => {
                                            isDone(clientName,"Promise Error",error);
                                        });
                                    } else {
                                        isDone(clientName);
                                    }
                                }
                            }

                            // update client's page index. 
                            pageIndexClient[clientName] = (vehicles.length == pageSize) ? (pageIndexClient[clientName]+pageSize) : 0;
                            console.log(`${clientName} -- Vehicles Length: ${vehicles.length} -- New Page Index: ${pageIndexClient[clientName]}`);

                            // loop each vehicle
                            vehicles.forEach(val => {

                                // check if the vehicle has devices because if not, it is instead a user.
                                if(val.devices.length > 0){

                                    // request vehicle's custom fields from WRU Main
                                    request({
                                        url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/users/${val.id}/customfields`,
                                        headers: {
                                            'Authorization': token
                                        }
                                    }, (error, response, body) => {

                                        // if no error and status code is 200 (OK)
                                        if (!error && (response||{}).statusCode == 200) {

                                            // convert the response body to JSON object
                                            const customField = JSON.parse(body);

                                            // get client's accepted custom fields
                                            const acceptedKeys = CLIENT_OPTIONS[clientName].customfields;
                                            
                                            // set the fields of the vehicle which will be updated
                                            const set = { 
                                                username: val.username, 
                                                name: val.name,
                                                devices: []
                                            };

                                            // save device Id and IMEI
                                            (val.devices||[]).forEach(dVal => {
                                                set.devices.push({
                                                    id: dVal.id,
                                                    imei: dVal.imei
                                                });
                                            });

                                            // only set/save the accepted custom fields
                                            customField.forEach(item => {
                                                if(acceptedKeys.includes(item.name)){
                                                    set[item.name] = (item.value||"").trim();
                                                }
                                            });

                                            // Custom Save Function
                                            if( typeof CLIENT_OPTIONS[clientName].customSave == 'function') {
                                                const newSaves = CLIENT_OPTIONS[clientName].customSave( set );
                                                Object.keys( set ).forEach(key => {
                                                    if( newSaves[key] ){
                                                        // replace existing value in set or add new value
                                                        set[key] = newSaves[key];
                                                    }
                                                });
                                            }

                                            // retrieve a vehicle from WRU database to check if there are new changes
                                            // this was added because this cloud function is called a lot of times. And if we save everytime it's called,
                                            // then we're updating the database with no new changes/updates. 
                                            // It also causes a small lag in WRU websites' changestream
                                            vehiclesCollection.find({ _id: val.id }).toArray().then(vDocs => {
                                                const vDoc = vDocs[0];

                                                if(vDoc){
                                                    var hasChanges = false;

                                                    // check if original value is NOT the same as new value
                                                    if(vDoc.name != val.name) hasChanges = true;
                                                    if(vDoc.username != val.username) hasChanges = true;
                                                    if(JSON.stringify(vDoc.devices) != JSON.stringify(val.devices)) hasChanges = true;

                                                    // loop vehicle's custom fields
                                                    customField.forEach(item => {
                                                        if(acceptedKeys.includes(item.name)){
                                                            // check if original value is NOT the same as new value
                                                            if(vDoc[item.name] != item.value) hasChanges = true;
                                                        }
                                                    });

                                                    // if there's at least one changes, update WRU database
                                                    if(hasChanges == true){
                                                        childPromise.push(vehiclesCollection.updateOne({ _id: val.id },{ $set: set },{ upsert: true }));
                                                    }
                                                } else {
                                                    // if there's at least one changes, update WRU database. 
                                                    // UPSERT is true, so it will add the data if it does not exist yet
                                                    childPromise.push(vehiclesCollection.updateOne({ _id: val.id },{ $set: set },{ upsert: true }));
                                                }

                                                isDoneProcessingVehicle();
                                            }).catch(error => {
                                                console.log("Error in Find Vehicle", error);
                                                isDoneProcessingVehicle();
                                            });
                                        } else {
                                            isDone(clientName,"Vehicle CF Request Error",error);
                                        }
                                    });
                                } else {
                                    isDoneProcessingVehicle();
                                }
                            });
                        } else {
                            isDone(clientName,"Vehicle Request Error",error);
                        }
                    });
                } else {
                    isDone(clientName,"Token Request Error",error);
                }
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
            implement(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});