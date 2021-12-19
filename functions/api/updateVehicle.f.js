/**
 * updateVehicle
 * 
 * >> API when called, updates vehicle data (usually name) <<
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const request = require('request');

// PRODUCTION
const prodURI = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const devURI = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

const clientApplicationId = {
    "9":    "wd-coket1",
    "4":    "wd-coket2",
    "14":   "wd-fleet",
    "427":  "wd-wilcon",
};

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {   
        
        /************** Variable Initialization **************/
        // initialize mongoDb Client
        const prodClient = yield mongodb.MongoClient.connect(prodURI,{ useUnifiedTopology: true }, { useNewUrlParser: true }, { connectTimeoutMS: 30000 }, { keepAlive: 1});
        const devClient = yield mongodb.MongoClient.connect(devURI,{ useUnifiedTopology: true }, { useNewUrlParser: true }, { connectTimeoutMS: 30000 }, { keepAlive: 1});
        
        const CLIENT_OPTIONS = {
            "wd-coket1": {   ggsURL: "coca-cola.server93.com",    appId: 9,      username: "wru_marielle",    password: "467388",      validBody: ['name']   },
            "wd-coket2": {   ggsURL: "coca-cola.server93.com",    appId: 4,      username: "wru_marielle",    password: "467388",      validBody: ['name']   }, 
            "wd-fleet":  {   ggsURL: "coca-cola.server93.com",    appId: 14,     username: "wru_marielle",    password: "467388",      validBody: ['name']   },
            "wd-wilcon": {   ggsURL: "wru.server93.com",          appId: 427,    username: "wru_marielle",    password: "ilovecats",   validBody: ['name']   },
        };

        var hasError = false; // check if there were error/s during process(). 
                                // the reason for this is to send status 500 after all CLIENTS are done 
                                // instead of returning error immediately while other CLIENTS (if available) 
                                // have not yet undergone through process().

        // array of promises
        const childPromise = [];
        /************** end Variable Initialization **************/

        // url parameters
        const reqBody = req.body;
        const params = req.params[0];
        const params_value = params.split("/").filter(x => x);

        // -------------------------------------------.../<APP_ID>/<Identifier>/<Value>
        // .../<APP_ID>/userId/<Value>
        // fields from url params
        const appId = params_value[0];
        const identifier = params_value[1];
        const value = params_value[2];

        console.log("params_value",params_value,params);

        // get client db name by appId
        const clientName = clientApplicationId[appId];
            
        if(clientName){

            // initialize database
            const dbName = clientName.split("|")[0];
            const prodDB = prodClient.db(dbName);
            const devDB = devClient.db(dbName);
            const prodVehiclesCollection = prodDB.collection('vehicles');
            const devVehiclesCollection = devDB.collection('vehicles');

            // get Main credentials
            const ggsURL = CLIENT_OPTIONS[clientName].ggsURL;
            const appId = CLIENT_OPTIONS[clientName].appId;
            const username = CLIENT_OPTIONS[clientName].username;
            const password = CLIENT_OPTIONS[clientName].password;
            const validBody = CLIENT_OPTIONS[clientName].validBody;

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

                    // only get valid body key/value
                    const ggsReqBody = {};
                    validBody.forEach(val => {
                        (reqBody[val]) ? ggsReqBody[val] = reqBody[val] : null;
                    });

                    if(Object.keys(ggsReqBody).length > 0){
                    
                        request({
                            method: 'PUT',
                            url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/users/${value}`,
                            headers: {
                                'Authorization': token
                            },
                            json: true,
                            body: ggsReqBody
                        }, (error, response, body) => {
    
                            // if no error and status code is 200 (OK)
                            if (!error && (response||{}).statusCode == 200) {
    
                                // update vehicle in db
                                childPromise.push(
                                    prodVehiclesCollection.updateOne(
                                        {
                                            _id: value
                                        }, 
                                        {
                                            $set: ggsReqBody
                                        }
                                    )
                                );
                                childPromise.push(
                                    devVehiclesCollection.updateOne(
                                        {
                                            _id: value
                                        }, 
                                        {
                                            $set: ggsReqBody
                                        }
                                    )
                                );

                                Promise.all(childPromise).then(docs => {
                                    isDone();
                                }).catch(error => {
                                    isDone("Promise All",error);
                                });
    
                            } else {
                                isDone("GGS Vehicle Update",error||body);
                            }
                        });
                    } else {
                        isDone("GGS Vehicle Update","Empty body");
                    }

                } else {
                    isDone("Token Request",error);
                }
            });
            

            /************** Functions **************/
            // will resolve the function depending if there was an error or not. Also, this will display the error if an error is passed
            // check if all CLIENTS[] are done
            function isDone(errTitle,err){ 
            
                // if error, display the title and error
                if(err) {
                    console.log(`Error in ${errTitle}:`,err);
                    hasError = true;
                }

                // close the mongodb client connection
                prodClient.close();
                devClient.close();
                
                // return 
                res.status(hasError?500:200).send(hasError?"ERROR":"OK");
            }
            /************** end Functions **************/

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