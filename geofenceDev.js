const co = require('co');
const mongodb = require('mongodb');
const request = require('request');

const pageIndexClient = {
    "coket1":0,
    "wilcon":0,
};
const wilconGeofenceGroupIdsArray = [8647,8640,9326,9332]; // 8647 - Store, 8640- Warehouse, 9326- PIER, 9332 - Processing
var wilconGeofenceGroupId = 8647;

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.geofenceDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET');

    const pageSize = 700;
    
    console.log("pageIndexClient",pageIndexClient," | pageSize",pageSize," | wilconGeofenceGroupId",wilconGeofenceGroupId);

    co(function*() {
        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                "coket1":null,
                "wilcon":null,
            },
            hasError = false,
            implement = function(clientName){
                const db = client.db(`wd-${clientName}`),
                      geofencesCollection = db.collection('geofences'),
                      ggsURL = process.env[`${clientName}_ggsurl`],
                      appId = process.env[`${clientName}_appid`],
                      username = process.env[`${clientName}_username`],
                      password = process.env[`${clientName}_password`];

                request({
                    method: 'POST',
                    url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tokens`,
                    headers: {
                        "Content-Type": "application/json"
                    },
                    json: true,
                    body: {username,password}
                }, (error, response, body) => {
                    if (!error && response.statusCode == 200) {
                        const token = body.token,
                            childPromise = [],
                            requestFunction = function(url){
                                request({
                                    url,
                                    headers: {
                                        'Authorization': token
                                    }
                                }, (error, response, body) => {
                                    if (!error && response.statusCode == 200) {
                                        try {
                                            var geofence_count = 0, g_count = 0;

                                            const geofence = JSON.parse(body);
                                            const checkIfDone = function(){
                                                if(geofence_count == g_count && geofence.length == geofence_count){
                                                    console.log("childPromise",childPromise.length);
                                                    if(childPromise.length > 0){
                                                        Promise.all(childPromise).then(docs => {
                                                            console.log(`docs for ${clientName}:`); // ,JSON.stringify(docs)
                                                            areClientsDone(clientName);
                                                        }).catch(error => {
                                                            console.log(`Promise Error: `,error);
                                                            hasError = true;
                                                            areClientsDone(clientName);
                                                        });
                                                    } else {
                                                        areClientsDone(clientName);
                                                    }
                                                }
                                            };

                                            console.log(`geofence for ${clientName}: length: ${geofence.length} -- `); // ,JSON.stringify(geofence)

                                            pageIndexClient[clientName] = (geofence.length == pageSize) ? (pageIndexClient[clientName]+pageSize) : 0;
                                            if(clientName == "wilcon"){
                                                if(geofence.length != pageSize){
                                                    for(var i = 0; i < wilconGeofenceGroupIdsArray.length; i++){
                                                        if(i < wilconGeofenceGroupIdsArray.length -1){
                                                            if(wilconGeofenceGroupIdsArray[i] == wilconGeofenceGroupId){
                                                                wilconGeofenceGroupId = wilconGeofenceGroupIdsArray[i+1];
                                                                break;
                                                            }
                                                        } else {
                                                            if(wilconGeofenceGroupIdsArray[i] == wilconGeofenceGroupId){
                                                                wilconGeofenceGroupId = wilconGeofenceGroupIdsArray[0];
                                                                break;
                                                            }
                                                        }
                                                    }
                                                    console.log("wilconGeofenceGroupId",wilconGeofenceGroupId);
                                                }
                                            }

                                            if(geofence.length > 0) {
                                                geofence.forEach(val => {
                                                    const updateGeofence = function(){
                                                        childPromise.push(geofencesCollection.updateOne({$or:[
                                                            { geofence_id: val.id },
                                                            { short_name: val.name },
                                                        ]},{$set: {geofence_id: val.id, short_name: val.name}},{upsert: true}));
                                                    };
                                                    
                                                    geofence_count++;
                                                    if(val.name.indexOf("-") < 0){
                                                        geofencesCollection.find({$or:[ { geofence_id: val.id }, { short_name: val.name }, ]}).toArray().then(gDocs => {
                                                            if(gDocs.length > 0){
                                                                var gDoc = gDocs[0],
                                                                    hasChanges = false;
        
                                                                if(gDoc.geofence_id != val.id) hasChanges = true;
                                                                if(gDoc.short_name != val.name) hasChanges = true;
    
                                                                if(hasChanges == true){
                                                                    updateGeofence();
                                                                    g_count++;
                                                                    checkIfDone();
                                                                } else {
                                                                    g_count++;
                                                                    checkIfDone();
                                                                }
                                                            } else {
                                                                updateGeofence();
                                                                g_count++;
                                                                checkIfDone();
                                                            }
                                                        }).catch(error => {
                                                            console.log("Error in Find Geofence", error.toString());
                                                            g_count++;
                                                            checkIfDone();
                                                        });
                                                        
                                                        // removed dispatch: [] and assigned: [] because it will reset values to [] every call.
                                                    } else {
                                                        g_count++;
                                                        checkIfDone();
                                                    }
                                                });
                                            } else {
                                                checkIfDone();
                                            }

                                            
                                        } catch (error){
                                            console.log("eerrorr",error);
                                            hasError = true;
                                            areClientsDone(clientName);
                                        }
                                    } else {
                                        console.log("Geofence Request Error",error);
                                        hasError = true;
                                        areClientsDone(clientName);
                                    }
                                });    
                            };
                        if(clientName == "wilcon"){
                            requestFunction(`https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/geofencegroups/${wilconGeofenceGroupId}/geofences?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`);
                        } else {
                            requestFunction(`https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/geofences?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`);   
                        }
                    } else {
                        console.log("Token Request Error",error);
                        hasError = true;
                        areClientsDone(clientName);
                    }
                });
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                console.log("CLIENTS",CLIENTS,done);
                if(done === true){
                    client.close();
                    res.status(hasError?500:200).send(hasError?"ERROR":"OK");
                }
            };

        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            implement(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        console.log("CO Error",error);
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};