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
            "zV8M2z81pPxhPJelifnz9tjmhwS9eSFIMelE": { clientName: "wm-wilcon" },
            "2adws30XULDc1MPZvGfTZDI8873qICCGv2aB": { clientName: "wm-orient_freight" }
        };

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Process **************/
        // check if token passed is valid
        if(CLIENT_OPTIONS[query.token]){
            
            // item_number is required (will serve as item's ID)
            if(query.item_number && query.company_code){

                // initialize database
                const clientName = CLIENT_OPTIONS[query.token].clientName;
                const db = client.db(clientName);
                const partsCollection = db.collection('parts');

                
                /*
                    Company Code
                    Item Number
                    Item Name
                    Qty
                    Cost Price
                    Brand Name
                    Brand Code
                    Supplier Code
                    Last Received Date
                    Last Withdraw Date
                */

                    
                // {
                //     "token":"zV8M2z81pPxhPJelifnz9tjmhwS9eSFIMelE",
                //     "company_code":"110",
                //     "item_number":"186300000001",
                //     "item_name":"XXXXX",
                //     "qty":"10",
                //     "cost_price":"49",
                //     "brand_name":"XXXXX",
                //     "brand_code":"G1001556",
                //     "supplier_code":"VICT02",
                //     "last_received_date":"",
                //     "last_withdraw_date":""
                // }

                // object to be saved to the db
                const obj = {};

                (![null,""].includes(query.company_code)) ? obj.company_code = query.company_code : null;
                (![null,""].includes(query.item_number)) ? obj.item_number = query.item_number : null;
                (![null,""].includes(query.item_name)) ? obj.item_name = query.item_name : null;
                (![null,""].includes(query.qty)) ? obj.qty = query.qty : null;
                (![null,""].includes(query.cost_price)) ? obj.cost_price = query.cost_price : null;
                (![null,""].includes(query.brand_name)) ? obj.brand_name = query.brand_name : null;
                (![null,""].includes(query.brand_code)) ? obj.brand_code = query.brand_code : null;
                (![null,""].includes(query.supplier_code)) ? obj.supplier_code = query.supplier_code : null;
                (![null,""].includes(query.last_received_date)) ? obj.last_received_date = query.last_received_date : null;
                (![null,""].includes(query.last_withdraw_date)) ? obj.last_withdraw_date = query.last_withdraw_date : null;

                if(Object.keys(obj).length > 0){
                    // update data and insert if does not exist yet
                    partsCollection.updateOne(
                        { 
                            company_code: query.company_code,
                            item_number: query.item_number,
                        },
                        { $set: obj },
                        { upsert: true }
                    ).then(docs => {
                        // print for debugging
                        console.log("Import Okay");
    
                        isDone();
                    }).catch(error => {
                        isDone("Parts (update)",error);
                    });
                } else {
                    // print for debugging
                    console.log("Empty query.");

                    isDone();
                }
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