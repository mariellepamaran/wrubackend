/**
 * vehicleInsuranceExpiration
 * 
 * >> Alert the users via email if the insurance of a vehicle is about to expire <<
 * 
 * Users are the one setting the expiration date. This function will notify the user
 * if the insurance is about to expire in 30 and 60 days.
 * This function will be called every 1st of the month
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
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

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {
  
    co(function*() {
        
        /************** Variable Initialization **************/
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
        const CLIENTS = {
            "wm-wilcon": null
        };
        const CLIENT_OPTIONS = {
            "wm-wilcon": { otherDb: "wilcon" }
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
            const insuranceCollection = db.collection('insurance');
            const insuranceListCollection = db.collection('insurance_list');
            const insuranceClassCollection = db.collection('insurance_class');
            
            const otherDb = client.db(CLIENT_OPTIONS[clientName].otherDb);
            const vehiclesCollection = otherDb.collection('vehicles');

            // retrieve all vehicles List 
            vehiclesCollection.find({}).toArray().then(vDocs => {
                // retrieve all Insurance List
                insuranceListCollection.find({}).toArray().then(ilDocs => {
                    // retrieve all Insurance Class
                    insuranceClassCollection.find({}).toArray().then(icDocs => {
                        // retrieve all Insurances
                        insuranceCollection.find({}).toArray().then(docs => {
    
                            const emailsToNotify = {}; // save the email and the ids of insurance (per xDays)
                                    // {
                                    //     <EMAIL>: {
                                    //         30: [ insurance1, insurance2 ],
                                    //         60: [ insurance3, insurance4 ]
                                    //     }
                                    // }
    
                            docs.forEach(val => {
    
                                // loop through each insurance of a vehicle and determine the 
                                // insurances that are about to expire in X days
                                (val.insurances || []).forEach((iVal, i) => {
    
                                    function inXdays(xDays) {
                                        // get difference (in days) between expiry date and today
                                        const diffDays = moment.tz(iVal.expiry_date, undefined, timezone).startOf('day').diff(now.startOf('day'), 'days');
    
                                        console.log("diffDays:", diffDays, "Expiry date:", iVal.expiry_date, "xDays", xDays, "ID:", val._id);
    
                                        // if diffDays is greater than 0 days
                                        // and diffDays is less than or equals to 30 or 60 (xDays)
                                        if (diffDays >= 0 && diffDays <= xDays) {
                                            // get insurance list
                                            const il = ilDocs.find(x => x._id.toString() == (iVal.insurance_list_id || "").toString()) || {};
                                            // get insurance class
                                            const ic = icDocs.find(x => x._id.toString() == (iVal.insurance_class_id || "").toString()) || {};
                                            // get vehicle
                                            const vehicle = vDocs.find(x => Number(x._id) == Number(val.vehicle_id)) || {};
    
                                            // only notify when the vehicle exists in the database
                                            if(vehicle.name){
                                                // notify the emails listed in this insurance
                                                (iVal.emails || []).forEach(to => {
                                                    // add the email and insurance data to the list (per xDays)
                                                    emailsToNotify[to] = emailsToNotify[to] || { 30: [], 60: [] };
                                                    emailsToNotify[to][xDays].push({
                                                        expiry_date: moment.tz(iVal.expiry_date, undefined, timezone).format(format.date),
                                                        vehicle: vehicle.name || "-",
                                                        platenum: vehicle["Plate Number"] || "-",
                                                        company: iVal.company || "-",
                                                        insurance: il.insurance || "-",
                                                        class: ic.class || "-",
                                                        policy_no: iVal.policy_no || "-",
                                                        remarks: iVal.remarks || ""
                                                    });
                                                });
                                            }
                                        }
                                    }
    
                                    inXdays(30);
                                    inXdays(60);
                                });
                            });
    
                            // notify the emails listed in each insurance
                            Object.keys(emailsToNotify).forEach(key => {
                                const receiver = key;
                                const perXdays = emailsToNotify[key];
    
                                // loop through the 30 and 60 fields of the EMAIL object.
                                Object.keys(perXdays).forEach(xDays => {
                                    // Wilcon requested that 30 days will be more 'urgent'.
                                    const emailSubject = (xDays == 30) ? "[Urgent] Insurances Expiring within 30 Days": "Insurances Expiring within 60 Days";
                                    // list of insurance data for this xDay
                                    const insuranceList = perXdays[xDays];
    
                                    childPromise.push(transporter.sendMail({
                                        from: '"WRU Maintenance" <noreply@wru.ph>', // sender address
                                        to: receiver, // list of receivers
                                        subject: emailSubject, // Subject line
                                        text: emailTemplate(xDays,insuranceList),
                                        html: emailTemplate(xDays,insuranceList),
                                    }));
                                });
                            });
    
                            if (childPromise.length > 0) {
                                Promise.all(childPromise).then(result => {
                                    console.log("Promise:", result);
                                    isDone(clientName);
                                }).catch(error => {
                                    isDone(clientName, 'Promise', error);
                                });
                            } else {
                                isDone(clientName);
                            }
                        }).catch(error => {
                            isDone(clientName, "Insurance", error);
                        });
                    }).catch(error => {
                        isDone(clientName, "Insurance Class", error);
                    });
                }).catch(error => {
                    isDone(clientName, "Insurance List", error);
                });
            }).catch(error => {
                isDone(clientName, "Vehicles", error);
            });
        }

        function emailTemplate(xDays,insuranceList) {
            var tbody = "";

            // sort the list by expiry date in ascending order
            insuranceList.sort(function(a, b) {
                var keyA = new Date(a.expiry_date);
                var keyB = new Date(b.expiry_date);
                // Compare the 2 dates
                if (keyA < keyB) return -1;
                if (keyA > keyB) return 1;
                return 0;
            });

            // add tbody trs to the string
            insuranceList.forEach(val => {
                tbody += ` <tr>
                            <td>${val.expiry_date}</td>
                            <td>${val.vehicle}</td>
                            <td>${val.platenum}</td>
                            <td>${val.company}</td>
                            <td>${val.insurance}</td>
                            <td>${val.class}</td>
                            <td>${val.policy_no}</td>
                            <td>${val.remarks}</td>
                        </tr>`;
            });

            return `<html lang="en">
                        <head>
                            <style>
                                body {
                                    font-family: Calibri;
                                    font-size: 13px;
                                }
                                table {
                                    border-collapse: collapse;
                                    border-spacing: 0;
                                    box-sizing: border-box;
                                    background-color: #e3e3e3;
                                    font-size: inherit;
                                    margin-top: 5px;
                                    text-align: left;
                                }
                                table tr th, table tr td {
                                    padding: 3px 8px;
                                    border: 1.5px solid white;
                                }
                                table tr th {
                                    background-color: #989898;;
                                    color: white;
                                    border-bottom: 2.5px solid white;
                                }
                                table tr:nth-child(even) {
                                    background-color: #f0f0f0;
                                }
                                table tr:nth-child(odd) {
                                    background-color: #e0e0e0;
                                }
                            </style>
                        </head>
                        <body>
                            <div>Good day,</div>
                            <br>
                            <div>A friendly reminder that the following insurances are about to expire within <b>${xDays} days</b>.</div>
                            <br>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Expiry Date</th>
                                        <th>Vehicle Type</th>
                                        <th>Plate Number</th>
                                        <th>Company</th>
                                        <th>Insurance</th>
                                        <th>Class</th>
                                        <th>Policy No</th>
                                        <th>Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>${tbody}</tbody>
                            </table>
                            <br>
                            <br>
                            <div>Thank you!</div>
                            <div><hr style="border: 0;border-top: 1px solid #eee;margin: 20px 0px;"></div>
                            <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${now.format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                        </body>
                    </html>`;
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