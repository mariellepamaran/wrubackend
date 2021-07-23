const co = require('co');
const mongodb = require('mongodb');
const request = require('request');

const pageIndexClient = {
    "coket1":0,
    "coket2":0,
    "fleet":0,
    "wilcon":0,
};

exports.vehicles = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET');

    try {
        request({
            method: 'GET',
            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/vehiclesDev`
        });
    } catch (error){
        console.log("Request Error",error);
    }

    const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
    const pageSize = 300;

    console.log("pageIndexClient",pageIndexClient," | pageSize",pageSize);

    co(function*() {
        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }, { useNewUrlParser: true }, { connectTimeoutMS: 30000 }, { keepAlive: 1}),
            CLIENTS = {
                  "coket1":null,
                  "coket2":null,
                  "fleet":null,
                  "wilcon":null,
            },
            hasError = false,
            implement = function(clientName){
                const db = client.db(`wd-${clientName}`),
                      vehiclesCollection = db.collection('vehicles'),
                      ggsURL = process.env[`${clientName}_ggsurl`],
                      appId = process.env[`${clientName}_appid`],
                      tagId = process.env[`${clientName}_tagid`],
                      username = process.env[`${clientName}_username`],
                      password = process.env[`${clientName}_password`];
                
                // Tag ID: 
                // CokeT2 - ALL T2
                // Wilcon - ALL 

                request({
                    method: 'POST',
                    url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tokens`,
                    headers: {
                        "Content-Type": "application/json"
                    },
                    json: true,
                    body: {username,password}
                }, (error, response, body) => {
                    if (!error && (response||{}).statusCode == 200) {
                        const token = body.token;
                        const childPromise = [];
                        var url = `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/users?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`;
                        if(["coket2","wilcon"].includes(clientName)){
                            url = `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tags/${tagId}/users?FromIndex=${pageIndexClient[clientName]}&PageSize=${pageSize}`;
                        }

                        request({
                            url,
                            headers: {
                                'Authorization': token
                            }
                        }, (error, response, body) => {
                            if (!error && (response||{}).statusCode == 200) {
                                const vehicles = JSON.parse(body);
                                const checkIfDone = function(){
                                    if(vehicle_count == cf_count && vehicles.length == vehicle_count){
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
                                var vehicle_count = 0, cf_count = 0;
                                console.log(`vehicles for ${clientName}: length: ${vehicles.length} -- `); // ,JSON.stringify(vehicles)

                                pageIndexClient[clientName] = (vehicles.length == pageSize) ? (pageIndexClient[clientName]+pageSize) : 0;

                                vehicles.forEach(val => {
                                    vehicle_count++;
                                    if(val.devices.length > 0){
                                        request({
                                            url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/users/${val.id}/customfields`,
                                            headers: {
                                                'Authorization': token
                                            }
                                        }, (error, response, body) => {
                                            if (!error && (response||{}).statusCode == 200) {
                                                const customField = JSON.parse(body);

                                                var acceptedKeys = [];
                                                
                                                if(clientName == "coket1"){
                                                    acceptedKeys = ["Trailer","Tractor Conduction","Base Site Code","Base Site","Equipment Number","Availability","Pal Cap","Site"];
                                                }
                                                if(clientName == "coket2"){
                                                    acceptedKeys = ["Trailer","Tractor Conduction","Base Site Code","Base Site","Equipment Number","Availability","Pal Cap","Site"];
                                                }
                                                if(clientName == "fleet"){
                                                    acceptedKeys = ["CN1","CN2","Fuel Capacity","Truck Model"];
                                                }
                                                if(clientName == "wilcon"){
                                                    acceptedKeys = ["Truck Number","Plate Number"];
                                                }
                                                
                                                const set = {username: val.username, name: val.name};
                                                const updateVehicle = function(){
                                                    childPromise.push(vehiclesCollection.updateOne({_id: val.id},{$set: set},{upsert: true}));
                                                };
                                                customField.forEach(item => {
                                                    if(acceptedKeys.includes(item.name)){
                                                        set[item.name] = (item.value||"").trim();
                                                    }
                                                });
                                                vehiclesCollection.find({_id: val.id}).toArray().then(vDocs => {
                                                    if(vDocs.length > 0){
                                                        var vDoc = vDocs[0],
                                                            hasChanges = false;

                                                        if(vDoc.name != val.name) hasChanges = true;
                                                        if(vDoc.username != val.username) hasChanges = true;
                                                        customField.forEach(item => {
                                                            if(acceptedKeys.includes(item.name)){
                                                                if(vDoc[item.name] != item.value) hasChanges = true;
                                                            }
                                                        });
                                                        if(hasChanges == true){
                                                            updateVehicle();
                                                            cf_count++;
                                                            checkIfDone();
                                                        } else {
                                                            cf_count++;
                                                            checkIfDone();
                                                        }
                                                    } else {
                                                        updateVehicle();
                                                        cf_count++;
                                                        checkIfDone();
                                                    }
                                                }).catch(error => {
                                                    console.log("Error in Find Vehicle", error);
                                                    cf_count++;
                                                    checkIfDone();
                                                });
                                            } else {
                                                console.log("Vehicle CF Request Error",(response||{}).statusCode,error);
                                                hasError = true;
                                                areClientsDone(clientName);
                                            }
                                        });
                                    } else {
                                        cf_count++;
                                        checkIfDone();
                                    }
                                });
                            } else {
                                console.log("Vehicle Request Error",(response||{}).statusCode,error);
                                hasError = true;
                                areClientsDone(clientName);
                            }
                        });
                    } else {
                        console.log("Token Request Error",(response||{}).statusCode,error);
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
        console.log("co error:",error);
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};