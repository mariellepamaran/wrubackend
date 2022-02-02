/**
 * emailExpirationDate
 * 
 * >> Send email notification --> LTFRB Reg - Send email 30 days before Expiration Date <<
 * 
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

    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/vehicleEmailExpirationDatexDev` }); } 
    catch (error){ console.log("Request Error",error); }

    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const format = {
            date: "MM/DD/YYYY",
            date_escaped: "MM_DD_YYYY",
            full_date: 'MMMM DD, YYYY',
            datetime: "MMM DD, YYYY, h:mm A"
        };
        const now = moment.tz(undefined, undefined, timezone); // get current time

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            "wilcon":null,
        };

        // array of promises
        const childPromise = [];

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

            // retrieve all vehicles
            vehiclesCollection.find({}).toArray().then(docs => {

                // store email & vehicle data here
                const emailsXvehicles = {};
                var expiryDate = null;

                docs.forEach(val => {

                    if(val['expiry_date']){
                        const diffDays = moment.tz(val['expiry_date'], undefined, timezone).startOf('day').diff(now.startOf('day'), 'days');

                        console.log('Diff days for:', val['Plate Number'], diffDays);

                        if(diffDays == 30){
                            
                            // save expiry date
                            expiryDate = moment.tz(val['expiry_date'], undefined, timezone).format(format.full_date);

                            // add email to list
                            (val.ltfrb_emails||[]).forEach(eVal => {
                                emailsXvehicles[eVal] = emailsXvehicles[eVal] || {};
                                
                                // add vehicle to email list
                                const vehicleKey = val['Plate Number'];
                                emailsXvehicles[eVal][vehicleKey] = {
                                    truck_number: val['Truck Number']
                                };
                            });
                        }
                    }
                });
                    
                // loop email list
                Object.keys(emailsXvehicles).forEach(eVal => {

                    const vehicle_list = emailsXvehicles[eVal];

                    // send email
                    childPromise.push(
                        transporter.sendMail({
                            from: '"WRU Corporation" <noreply@wru.ph>', // sender address
                            to: eVal, // list of receivers
                            subject: `LTFRB Expiration`,
                            text: emailTemplate( expiryDate, vehicle_list ),
                            html: emailTemplate( expiryDate, vehicle_list ),
                        })
                    );
                });

                if(childPromise.length > 0){
                    Promise.all(childPromise).then(result => {
                        console.log('Successful result', result);
                        isDone(clientName);
                    }).catch(error => {
                        isDone(clientName,"Promise All",error);
                    });
                } else {
                    console.log("Empty");
                    isDone(clientName);
                }
            }).catch(error => {
                isDone(clientName,"Vehicles (Find)",error);
            });
        };

        function emailTemplate( expiryDate, vehicle_list={} ) {
            var tbody = "";

            Object.keys(vehicle_list).forEach(key => {
                const truck_number = vehicle_list[key].truck_number;
                tbody += `<tr>
                            <td>${key}</td>
                            <td>${truck_number}</td>
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
                            <div>A friendly reminder that the LTFRB expiration date for the following vehicles will be on ${expiryDate}.</div>
                            <br>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Plate Number</th>
                                        <th>Truck Number</th>
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