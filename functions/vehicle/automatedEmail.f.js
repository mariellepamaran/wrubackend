 /**
 * vehicleAutomatedEmail
 * 
 * >> Send to clients via email the list of vehicles <<
 * 
 * This function's sole purpose is to send the list of vehicles to the clients via email
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const { readFile, writeFile } = require('fs').promises;
const transporter = nodemailer.createTransport({
    host: "mail.wru.ph",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: "dispatch@wru.ph",
        pass: "cNS_PMJw7FNz",
    },
});

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

// list of cc receivers
const emails = {
    "wd-coket1": ["lct.automation@coca-cola.com.ph","teng@wru.ph"],
    "wd-coket2": ["lct.automation@coca-cola.com.ph","teng@wru.ph"],
};
 
exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {
  
    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const format = {
            date: "MM/DD/YYYY",
            date_escaped: "MM_DD_YYYY",
            datetime: "MMM DD, YYYY, h:mm A"
        };
        const now_format1 = moment.tz(undefined, undefined, timezone).format(format.date); // current time formatted
        const now_format2 = moment.tz(undefined, undefined, timezone).format(format.date_escaped);  // current time formatted

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            "wd-coket1":null,
            "wd-coket2":null,
        };
        const CLIENT_OPTIONS = {
            "wd-coket1": { name: "CokeT1", cc: emails['wd-coket1'] },
            "wd-coket2": { name: "CokeT2", cc: emails['wd-coket2'] },
        };

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function process(clientName){
            // initialize database
            const db = client.db(clientName);
            const vehiclesCollection = db.collection('vehicles');

            // output variables
            const outputFileName = `${CLIENT_OPTIONS[clientName].name}_Truck_Data_${now_format2}.csv`;
            const outputFilePath = `/tmp/${outputFileName}`;

            // retrieve all vehicles
            vehiclesCollection.find({}).toArray().then(docs => {

                // store vehicle data here
                const data = [];

                docs.forEach(val => {
                    data.push({
                        "Truck": val["name"] || "",
                        "Trailer": val["Trailer"] || "",
                        "Equipment Number": val["Equipment Number"] || "",
                        "Tractor Conduction": val["Tractor Conduction"] || "",
                        "Availability": val["Availability"] || "",
                        "Last Seen": val.last_seen ? moment.tz(val.last_seen, undefined, timezone).format(format.datetime) : "",
                        "Offline Remarks": val["Offline Remark"] || ""
                    });
                });

                // start converting array of vehicle data to CSV
                (async () => {
                    const escapeToken = '~~~~'; // could be anything. But better to make it unique so it won't overwrite the actual data
                    const escapedData = escapeCommas(data, escapeToken);
                    const escapedCSV = arrayToCSV(escapedData);
                    const CSV = unescapeCommas(escapedCSV,escapeToken);
                    await writeCSV(outputFilePath, CSV);
                    console.log(`Successfully converted ${outputFileName}!`);

                    // send attachment to client
                    transporter.sendMail({
                        from: '"WRU Corporation" <noreply@wru.ph>', // sender address
                        cc: CLIENT_OPTIONS[clientName].cc || [], // list of receivers
                        // cc: ["mariellepamaran@gmail.com","mariellepamaran@yahoo.com","marielle@wru.ph"], // list of receiver (for testing purposes only)
                        subject: `${CLIENT_OPTIONS[clientName].name} Truck Data - ${now_format1}`,
                        text: "",
                        html: "",
                        attachments: [{ filename: outputFileName, path: outputFilePath  }], //  __dirname + '/pdf/test.pdf'
                    }, function(error, info){
                        console.log(clientName,((error) ? "Error sending the email." : "Email successfully sent!"));
                        isDone(clientName);
                    }); 
                })();
            }).catch(error => {
                isDone(clientName,"Vehicles (Find)",error);
            });
        };

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

        /*********** ARRAY TO CSV ***********/
        /* var data = [  { a:"1", b:"2" }, { a:"3", b:"4" }, { a:"5", b:"6,7" } ]; */

        // replace all commas (,) with the 'escapeToken'
        function escapeCommas (data, token) {
            return data.map(row => {
                var obj = {};
                Object.keys(row).forEach(key => { obj[key] = row[key].replace(/,/g, token); });
                return obj;
            });
        }

        // convert array to csv string
        function arrayToCSV (data) {
            csv = data.map(row => Object.values(row));
            csv.unshift(Object.keys(data[0]));
            return `"${csv.join('"\n"').replace(/,/g, '","')}"`;
        }
        
        // replace all 'escapeToken' with comma (,)
        function unescapeCommas (data, token) {
            data.replace(/~~~~/g,",")
            return data.replace(new RegExp(`${token}`, 'g'), ',');
        }

        // write the csv file
        async function writeCSV (fileName, data) {
            await writeFile(fileName, data, 'utf8');
        }
        /*********** END ARRAY TO CSV ***********/
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