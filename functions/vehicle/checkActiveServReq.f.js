/**
 * checkActiveServReq
 * 
 * >> Check if there are 'active' SRs (Service Requests) for the vehicle. Goal is to
 *    block or disable the vehicle in WRU Dispatch (front-end) if there's 'active' SR.  <<
 * 
 * This function will loop the vehicle database and check each if there's an 'active' SR.
 * By 'active' we mean any status EXCEPT 'pending' and 'complete'.
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const request = require('request');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {
  
    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/vehicleCheckActiveServReqxDev` }); } 
    catch (error){ console.log("Request Error",error); }
    
    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            "wm-wilcon": null,
            "wm-orient_freight": null
        };
        const CLIENT_OPTIONS = {
            "wm-wilcon": { otherDb: "wilcon" },
            "wm-orient_freight": { otherDb: "orient_freight" },
        };


        // array of promises
        const childPromise = [];
        
        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function process(clientName) {
            // initialize database
            const db = client.db(clientName);
            const srCollection = db.collection('sr');
            
            const otherDb = client.db(CLIENT_OPTIONS[clientName].otherDb);
            const vehiclesCollection = otherDb.collection('vehicles');

            // retrieve all vehicles List 
            vehiclesCollection.find({}).toArray().then(vDocs => {

                // number of sr checked must be equal to number of vehicles
                var srChecked = 0;

                // function that checked if number of sr checked is equal to vehicles length
                function checkSrEqualVehicles(){
                    // increase srChecked value
                    srChecked ++;

                    // check if vehicles length is equal to sr checked
                    if(vDocs.length == srChecked){
                        Promise.all(childPromise).then(result => {
                            isDone(clientName);
                        }).catch(error => {
                            // return error
                            isDone(clientName, "Promise", error);
                        });
                    }
                }

                // loop vehicle list
                vDocs.forEach(vVal => {

                    // get count of 'active' SRs for the vehicle
                    srCollection.find({ 
                        vehicle_id: vVal._id,
                        status: {
                            $nin: ['pending','complete']
                        }
                    }).count({}, function(err, numOfDocs){
                        if(err) next(_ERROR_.INTERNAL_SERVER(err));
                        
                        // if there are 'active' SRs, update vehicle
                        const underMaintenance = (numOfDocs > 0) ? true : false;
                        
                        // push db update promise
                        childPromise.push(
                            vehiclesCollection.updateOne(
                                {
                                    _id: vVal._id
                                },
                                {
                                    $set: {
                                        underMaintenance: underMaintenance
                                    }
                                }
                            )
                        );

                        // check if number of sr checked is equal to vehicles length
                        checkSrEqualVehicles();
                    });
                });
            }).catch(error => {
                isDone(clientName, "Vehicles", error);
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
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});