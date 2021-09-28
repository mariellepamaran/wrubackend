/**
 * withdrawal
 * 
 * 
 */

 const co = require('co');
 const mongodb = require('mongodb');
 const moment = require('moment-timezone');
 
// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

 exports.withdrawal = (req, res) => {
     res.set('Content-Type','application/json');
     res.set('Access-Control-Allow-Origin', '*');
     res.set('Access-Control-Allow-Headers', '*');
     res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
 
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
         const nowMs = now.valueOf(); // get current time in milliseconds
 
         // initialize mongoDb Client
         const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });
 
         // list of clients. Key is usually the db name
         const CLIENTS = {
             "wm-wilcon":null,
         };
 
         var hasError = false; // check if there were error/s during process(). 
                               // the reason for this is to send status 500 after all CLIENTS are done 
                               // instead of returning error immediately while other CLIENTS (if available) 
                               // have not yet undergone through process().
         /************** end Variable Initialization **************/
 
 
         /************** Functions **************/
         function process (clientName){
            if((method||"").toUpperCase() == "POST"){

                // initialize database
                const db = client.db(clientName);
                // const dispatchCollection = db.collection('dispatch');
    
                // const OBJECT = {
                //     sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                //     getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
                // };

                // const stage1 = ["Order No","Withdrawal No","Status"];
                // const


                isDone(clientName);
            } else {
                client.close();
                res.status(405).send("Method Not Allowed");
            }
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
                 client.close();
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
         res.status(500).send('Error: ' + JSON.stringify(error));
     });
 };