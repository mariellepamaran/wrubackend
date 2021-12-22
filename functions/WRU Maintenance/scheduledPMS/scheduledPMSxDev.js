/**
 * scheduledPMS
 * 
 * >> Alert the users via email 3 days before the scheduled Preventive Maintenance <<
 * 
 * Users are the one setting the monthly interval of the alert they want. This function will notify
 * the users if interval has been reached (3 days before). This function will also save when's the next alert will be
 * based on the interval user has picked.
 * 
 */

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

// PRODUCTION
// const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.scheduledPMSxDev = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

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
            "wm-wilcon":null,
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
        function process(clientName){
            // initialize database
            const db = client.db(clientName);
            const pmsRequestsCollection = db.collection('pms_requests');
            
            const otherDb = client.db(CLIENT_OPTIONS[clientName].otherDb);
            const vehiclesCollection = otherDb.collection('vehicles');

            // alerting the users with this number of days before the next scheduled date
            const alertDaysBefore = 3;

            /**
             * REMEMBER
             * Date started and Date Finished are just reference dates for when the PMS checklist was 
             * actually carries out. No need for it to affect anything system-wise
             * - Vincent Sorreta
             */

            // retrieve all vehicles from WRU Dispatch database (just return what is needed. ID and Vehicle Name)
            vehiclesCollection.aggregate([
                {
                    $project: {
                        "_id": 1,
                        "name": 1,
                    }
                }
            ]).toArray().then(vDocs => {
                // retrieve pms requests data where status is either "approved" or "ongoing"
                // also get the PMS data linked to the request
                // Return only what is needed (check $project).
                pmsRequestsCollection.aggregate([
                    { 
                        $match: { status: { $in: ["approved","ongoing"] } }
                    },
                    { 
                        $lookup: {
                            from: 'pms',
                            localField: 'vehicle_id',
                            foreignField: '_id',
                            as: 'pms',
                        }
                    },
                    { $unwind: "$pms" }, // do not preserveNull. vehicle is required
                    {
                        $project: {
                            "_id": 1,
                            "next_sc_date": 1,
                            "vehicle_id": 1,
                            "emails": 1,

                            "pms.months": 1,
                        }
                    }
                ]).toArray().then(docs => { 
                    if(docs.length > 0){
                        // loop through the pms requests
                        docs.forEach(val => {

                            // get the vehicle data from the vehicle ID
                            const vehicle = vDocs.find(x => x._id == val.vehicle_id);

                            // make sure that the vehicle exists in the database and there's a PMS linked to the request
                            if(vehicle && val.pms && val.next_sc_date){
                                // Note:
                                // next_sc_date = next scheduled date
                                // last_sc_date = last scheduled date
    
                                // set last_sc_date value to next_sc_date
                                const last_sc_date = val.next_sc_date;
                                // set next_sc_date to be the next_sc_date + months(interval)
                                const next_sc_date = moment.tz(val.next_sc_date, undefined, timezone).add(val.months, 'months').toISOString();
                                // get difference (in days) between next scheduled date and today
                                const diffDays = moment.tz(val.next_sc_date, undefined, timezone).startOf('day').diff( now.startOf('day'), 'days' );
                                console.log("diffDays",diffDays,"ID:",val._id);
    
                                // if its alertDaysBefore(3) days before the next scheduled date, alert users
                                if(diffDays == alertDaysBefore){
    
                                    // notify the emails listed in this pms
                                    (val.emails||[]).forEach(to => {
                                        const months = val.pms.months;
                                        childPromise.push(transporter.sendMail({
                                            from: '"WRU Maintenance" <noreply@wru.ph>', // sender address
                                            to: to || `wru.developer@gmail.com`, // list of receivers
                                            subject: `Scheduled Checklist - ${vehicle.name}`, // Subject line
                                            text: emailTemplate(months,last_sc_date,next_sc_date),
                                            html: emailTemplate(months,last_sc_date,next_sc_date),
                                        }));
                                    });
    
                                    // update this pms' next scheduled date and last scheduled date, and status
                                    childPromise.push(pmsRequestsCollection.updateOne({_id: val._id}, {   
                                        $set: { next_sc_date, last_sc_date }
                                    })); 
                                } 

                                // if diffdays is 0 -- meaning schedule is today
                                if(diffDays == 0){
                                    // update this pms' status
                                    childPromise.push(pmsRequestsCollection.updateOne({_id: val._id}, {   
                                        $set: { status: "ongoing" }
                                    })); 
                                }
                            } 
                        });
                        if(childPromise.length > 0){
                            Promise.all(childPromise).then(result => {
                                console.log("Promise:",result.toString());
                                isDone(clientName);
                            }).catch(error => {
                                isDone(clientName,"Promise",error);
                            });
                        } else {
                            isDone(clientName);
                        }
                    } else {
                        isDone(clientName);
                    }
                }).catch(error => {
                    isDone(clientName,"PMS Requests",error);
                });
            }).catch(error => {
                isDone(clientName,"Vehicles",error);
            });
        }

        function emailTemplate(months,last_sc_date,next_sc_date){
            const nextScDateHTML = (next_sc_date) ? `<div>Next schedule will be after <b>${months}</b> month/s, <b>${moment.tz(next_sc_date, undefined, timezone).format(format.date)}</b>.</div>` : "";
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
                            <div>This is a reminder of the Preventive Maintenance that is scheduled on <b>${moment.tz(last_sc_date, undefined, timezone).format(format.date)}</b>.</div>
                            ${nextScDateHTML}
                            <br>
                            <br>
                            <div>Thank you!</div>
                            <div><hr style="border: 0;border-top: 1px solid #eee;margin: 20px 0px;"></div>
                            <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${ now.format("YYYY") } <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
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
};