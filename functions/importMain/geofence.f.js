/**
 * geofence
 * 
 * >> Request geofence data from WRU Main and save to WRU database <<
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
    // "coket1": 0,
    // "coket2": 0,
    // "fleet|fromT1" : 0,
    // "fleet|fromT2" : 0,
    "wilcon": 0,
    "orient_freight": 0,
};
const geofenceGroupIdClient = {
    "wilcon": 8647
};

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/importMainGeofencexDev` }); } 
    catch (error){ console.log("Request Error",error); }

    // the maximum number of data to be requested from WRU Main per function call
    const pageSize = 700;
    
    console.log("pageIndexClient",pageIndexClient," | pageSize",pageSize," | geofenceGroupIdClient",geofenceGroupIdClient);

     co(function*() {
        
        /************** Variable Initialization **************/
        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            // "coket1": null,
            // "coket2": null,
            // "fleet|fromT1" : null,
            // "fleet|fromT2" : null,
            "wilcon": null,
            "orient_freight": null,
        };
        const CLIENT_OPTIONS = {
            // "coket1": {  identifier: 'T1',      ggsURL: "coca-cola.server93.com",    appId: 9,      username: "wru_marielle",    password: "467388",       geofenceGroupIds: null,      ignoreWithString: ' - '                     },
            // "coket2": {  identifier: 'T2',      ggsURL: "coca-cola.server93.com",    appId: 4,      username: "wru_marielle",    password: "467388",       geofenceGroupIds: null,      ignoreWithString: ' - '                     },
            "wilcon":         {  identifier: 'Wilcon',         ggsURL: "wru.server93.com",          appId: 427,    username: "wru_marielle",    password: "ilovecats",    geofenceGroupIds: [8647,8640,9326,9332],      ignoreWithString: '-'    },
                                                                                                                                                                        // 8647 - Store, 8640- Warehouse, 9326- PIER, 9332 - Processing
            "orient_freight": {  identifier: 'OrientFreight',  ggsURL: "wru.server93.com",          appId: 468,    username: "wru_marielle",    password: "ilovecats",    geofenceGroupIds: null,      ignoreWithString: null    },
                                                                                                                                        
                                                                                                
            // "fleet|fromT1":  {  importFrom: "coket1",    geofenceIdentifier: 'short_name'        },
            // "fleet|fromT2":  {  importFrom: "coket2",    geofenceIdentifier: 'short_name'        },
        };

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function implement (clientName){
            // initialize database
            const dbName = clientName.split("|")[0];
            const otherDb = client.db(dbName);
            const geofencesCollection = otherDb.collection('geofences');

            // import options
            const importFrom = CLIENT_OPTIONS[clientName].importFrom;
            const geofenceIdentifier = CLIENT_OPTIONS[clientName].geofenceIdentifier || 'id';
            const ignoreWithString = CLIENT_OPTIONS[clientName].ignoreWithString;

            // get Main credentials
            const ggsURL = CLIENT_OPTIONS[ importFrom || clientName ].ggsURL;
            const appId = CLIENT_OPTIONS[ importFrom || clientName ].appId;
            const username = CLIENT_OPTIONS[ importFrom || clientName ].username;
            const password = CLIENT_OPTIONS[ importFrom || clientName ].password;
            const geofenceGroupIds = CLIENT_OPTIONS[ importFrom || clientName ].geofenceGroupIds;

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
                if (!error && response.statusCode == 200) {

                    // store token
                    const token = body.token;

                    // array of promises
                    const childPromise = [];

                    // request URL for clients with Geofence Group is different
                    // because WD only saves data from that specific geofence group
                    const url = (geofenceGroupIdClient[clientName]) ? 
                                `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/geofencegroups/${geofenceGroupIdClient[clientName]}/geofences?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}` : 
                                `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/geofences?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`;

                         
                    // request geofence data from WRU Main       
                    request({
                        url,
                        headers: {
                            'Authorization': token
                        }
                    }, (error, response, body) => {

                        // if no error and status code is 200 (OK)
                        if (!error && response.statusCode == 200) {
                            try {
                                // convert the response body to JSON object
                                const geofence = JSON.parse(body);

                                var g_count = 0;

                                function isDoneProcessingGeofence(notCount){
                                    // only increase 'g_count' if notCount is NOT true
                                    notCount ? null : g_count ++;

                                    if(geofence.length == g_count){
                                        if(childPromise.length > 0){
                                            Promise.all(childPromise).then(docs => {
                                                isDone(clientName);
                                            }).catch(error => {
                                                isDone(clientName,"Promise",error);
                                            });
                                        } else {
                                            isDone(clientName);
                                        }
                                    }
                                };

                                // update client's page index. 
                                pageIndexClient[clientName] = (geofence.length == pageSize) ? (pageIndexClient[clientName]+pageSize) : 0;

                                // update client's geofence group id
                                if(geofenceGroupIds){
                                    if(geofence.length != pageSize){
                                        // loop through client's geofence group IDs
                                        for(var i = 0; i < geofenceGroupIds.length; i++){

                                            // if geofenceGroupIds[i] is equal to this function call's geofence group id
                                            if(geofenceGroupIds[i] == geofenceGroupIdClient[clientName]){
                                                if(i < geofenceGroupIds.length -1){
                                                    // set geofence group id to NEXT geofence group id
                                                    geofenceGroupIdClient[clientName] = geofenceGroupIds[i+1];
                                                    break;
                                                } else {
                                                    // set geofence group id back to 0 (or first geofence group id)
                                                    geofenceGroupIdClient[clientName] = geofenceGroupIds[0];
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                console.log(`${clientName} -- Geofence Length: ${geofence.length} -- New Page Index: ${pageIndexClient[clientName]} -- Geofence Group Id: ${geofenceGroupIdClient[clientName]}`);


                                if(geofence.length > 0) {
                                    geofence.forEach(val => {

                                        // set geofence query
                                        var geofenceQuery = { geofence_id: val.id };
                                        if(geofenceIdentifier == 'short_name'){
                                            geofenceQuery = { short_name: val.name };
                                        }

                                        function updateGeofence(){
                                            // set the fields of the vehicle which will be updated
                                            const set = { geofence_id: val.id, short_name: val.name };

                                            // update geofence if either $or condition is correct
                                            // UPSERT is true, so it will add the data if it does not exist yet
                                            childPromise.push(geofencesCollection.updateOne(geofenceQuery,{ $set: set },{ upsert: true }));
                                        }
                                        
                                        // we're checking if the geofence name does not have a substring of "-" because 
                                        // we're only saving the 'main' geofece
                                        // Sample geofences:
                                        //     > CNL PL               >>>>>>>>>> only save this
                                        //     > CNL PL - Processing
                                        //     > CNL PL - Queueing
                                        
                                        if(!ignoreWithString || val.name.indexOf(ignoreWithString) < 0){

                                            // retrieve a geofence from WRU database to check if there are new changes
                                            // this was added because this cloud function is called a lot of times. And if we save everytime it's called,
                                            // then we're updating the database with no new changes/updates. 
                                            // It also causes a small lag in WRU websites' changestream
                                            geofencesCollection.find(geofenceQuery).toArray().then(gDocs => {
                                                const gDoc = gDocs[0];

                                                if(gDoc){
                                                    var hasChanges = false;

                                                    // check if original value is NOT the same as new value
                                                    if(gDoc.geofence_id != val.id) hasChanges = true;
                                                    if(gDoc.short_name != val.name) hasChanges = true;

                                                    if(hasChanges == true){
                                                        updateGeofence();
                                                    }
                                                } else {
                                                    updateGeofence();
                                                }

                                                isDoneProcessingGeofence();
                                            }).catch(error => {
                                                console.log("Error in Find Geofence", error);
                                                isDoneProcessingGeofence();
                                            });
                                        } else {
                                            isDoneProcessingGeofence();
                                        }
                                    });
                                } else {
                                    isDoneProcessingGeofence(true);
                                }
                            } catch (error){
                                isDone(clientName,"Try/Catch",error);
                            }
                        } else {
                            isDone(clientName,"Geofence Request Error",error);
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