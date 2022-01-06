/**
 * orderUpdate
 * 
 * >> Allows the client to update the parts data of a request <<
 * 
 * This function will require users to send a token (provided by us) every call.
 * Based on the flowchart sent by Wilcon
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');

// PRODUCTION
// const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"


exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {
            
        /************** Variable Initialization **************/
        // request data
        const method = req.method;
        const body = req.body;
        const query = req.query;

        // print request data
        console.log("Method:",method);
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));

        
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const format = {
            date: "MMM DD, YYYY",
            time: "h:mm A",
            datetime: "MMM DD, YYYY, h:mm A"
        };
        const now = moment.tz(undefined, undefined, timezone); // get current time

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENT_OPTIONS = {
            // 36-digit
            "zV8M2z81pPxhPJelifnz9tjmhwS9eSFIMelE": { clientName: "wm-wilcon" }
        };

        var hasError = false; // check if there were error/s during process(). 
                            // the reason for this is to send status 500 after all CLIENTS are done 
                            // instead of returning error immediately while other CLIENTS (if available) 
                            // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Universal Functions **************/

        // a function that checks if an array(arr) contains all values from another array(target)
        const checker = (arr, target) => target.every(v => arr.includes(v));

        /************** end Universal Functions **************/

        
        /************** Process **************/
        // check if token passed is valid
        if(CLIENT_OPTIONS[query.token]){

            const requiredParams = ["service_type","service_id","line_id"];
            
            // if client sent all required parameters
            if(checker(Object.keys(query),requiredParams)){

                // initialize database
                const clientName = CLIENT_OPTIONS[query.token].clientName;
                const db = client.db(clientName);
                const serviceCollection = (query.service_type == "pms") ? "pms_requests" : query.service_type;
                const unknownCollection = db.collection(serviceCollection);

                
                /*
                    Parameters expected/required:
                    > Service Type (SR/PMS)
                    > Service ID

                    > Line ID

                    > Plan Order
                    > Status
                    > PO Number
                    > Order Number
                    > Withdrawal Number
                    > Supplier Code
                */

                unknownCollection.find({ _id: query.service_id }).toArray().then(docs => {
                    const doc = docs[0];

                    if(doc){

                        // object to be updated to the db
                        const set = {};

                        // **SR**
                        if(query.service_type == "sr"){
                            
                            /*
                                DB Structure for SR
                                    > _id
                                    > category
                                        > UNKNOWN_CATEGORY
                                            > parts
                                                > <ARRAY>
                                                    > line_id
                            */

                            // loop each category
                            Object.keys(doc.category||{}).forEach(key => {
    
                                // loop through parts array of each category
                                Object.keys(doc.category[key].parts||{}).forEach(line_id => {
    
                                    // check if part's line id is equal to param's line id
                                    if(line_id == query.line_id){
    
                                        // check if no data has been added yet (just extra checking). Line ID is usually unique
                                        if(Object.keys(set).length == 0){
                                            
                                            // only add data to "set" is query params exists
                                            (![null,undefined].includes(query.plan_order)) ? set[`category.${key}.parts.${line_id}.plan_order`] = query.plan_order : null;
                                            (![null,undefined].includes(query.status)) ? set[`category.${key}.parts.${line_id}.status`] = query.status : null;
                                            (![null,undefined].includes(query.po_number)) ? set[`category.${key}.parts.${line_id}.po_number`] = query.po_number : null;
                                            (![null,undefined].includes(query.order_number)) ? set[`category.${key}.parts.${line_id}.order_number`] = query.order_number : null;
                                            (![null,undefined].includes(query.withdrawal_number)) ? set[`category.${key}.parts.${line_id}.withdrawal_number`] = query.withdrawal_number : null;
                                            (![null,undefined].includes(query.supplier_code)) ? set[`category.${key}.parts.${line_id}.supplier_code`] = query.supplier_code : null;
                                        }
                                    }
                                });
                            });
                        } else if(query.service_type == "tires"){
                            
                            /*
                                DB Structure for Tires
                                    > _id
                                    > services
                                        > UNKNOWN_CATEGORY
                                            > parts
                                                > <ARRAY>
                                                    > line_id
                            */

                            // loop each services
                            Object.keys(doc.services||{}).forEach(key => {
    
                                // loop through parts array of each services
                                Object.keys(doc.services[key].parts||{}).forEach(line_id => {
    
                                    // check if part's line id is equal to param's line id
                                    if(line_id == query.line_id){
    
                                        // check if no data has been added yet (just extra checking). Line ID is usually unique
                                        if(Object.keys(set).length == 0){
                                            
                                            // only add data to "set" is query params exists
                                            (![null,undefined].includes(query.plan_order)) ? set[`services.${key}.parts.${line_id}.plan_order`] = query.plan_order : null;
                                            (![null,undefined].includes(query.status)) ? set[`services.${key}.parts.${line_id}.status`] = query.status : null;
                                            (![null,undefined].includes(query.po_number)) ? set[`services.${key}.parts.${line_id}.po_number`] = query.po_number : null;
                                            (![null,undefined].includes(query.order_number)) ? set[`services.${key}.parts.${line_id}.order_number`] = query.order_number : null;
                                            (![null,undefined].includes(query.withdrawal_number)) ? set[`services.${key}.parts.${line_id}.withdrawal_number`] = query.withdrawal_number : null;
                                            (![null,undefined].includes(query.supplier_code)) ? set[`services.${key}.parts.${line_id}.supplier_code`] = query.supplier_code : null;
                                        }
                                    }
                                });
                            });
                        } else {
                            // **PMS**
                            
                            /*
                                DB Structure for PMS
                                    > _id
                                    > parts
                                        > <ARRAY>
                                            > line_id
                            */

                            // loop through parts
                            Object.keys(doc.parts||{}).forEach(line_id => {

                                // check if part's line id is equal to param's line id
                                if(line_id == query.line_id){

                                    // check if no data has been added yet (just extra checking). Line ID is usually unique
                                    if(Object.keys(set).length == 0){
                                        
                                        // only add data to "set" is query params exists
                                        (![null,undefined].includes(query.plan_order)) ? set[`parts.${line_id}.plan_order`] = query.plan_order : null;
                                        (![null,undefined].includes(query.status)) ? set[`parts.${line_id}.status`] = query.status : null;
                                        (![null,undefined].includes(query.po_number)) ? set[`parts.${line_id}.po_number`] = query.po_number : null;
                                        (![null,undefined].includes(query.order_number)) ? set[`parts.${line_id}.order_number`] = query.order_number : null;
                                        (![null,undefined].includes(query.withdrawal_number)) ? set[`parts.${line_id}.withdrawal_number`] = query.withdrawal_number : null;
                                        (![null,undefined].includes(query.supplier_code)) ? set[`parts.${line_id}.supplier_code`] = query.supplier_code : null;
                                    }
                                }
                            });
                        }
                        

                        // update db if only there's at least one (1) thing to update
                        if(Object.keys(set).length > 0){
                            unknownCollection.updateOne(
                                { _id: query.service_id },
                                {
                                    $set: set
                                }
                            ).then(docs => {
                                // print for debugging
                                console.log("Update okay. Set:",set);
            
                                isDone();
                            }).catch(error => {
                                isDone("Unknown (update)",error);
                            });
                        } else {
                            // print for debugging
                            console.log("Update empty.");

                            isDone();
                        }
                    } else {
                        // return 400 (Bad Request) error
                        res.status(400).send("Bad Request. Invalid 'service_type' or 'service_id'.");
                    }
                }).catch(error => {
                    isDone("Unknown (find)",error);
                });
            } else {
                // return 400 (Bad Request) error
                res.status(400).send("Bad Request");
            }

        } else {
            // return 401 (Unauthorized) error
            res.status(401).send("Unauthorized");
        }
        /************** end Process **************/


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
            client.close();
            
            // return 
            res.status(hasError?500:200).send(hasError?"ERROR":"OK");
        }
        /************** end Functions **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});