const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
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
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.scheduledChecklistDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                  "wilcon":null,
            },
            hasError = false,
            childPromise = [],
            process = function(clientName){
                const db = client.db(`wm-${clientName}`),
                    scCollection = db.collection('sc');

                /**
                 * REMEMBER
                 "Date started and Date Finished are just reference dates for when the PMS checklist was actually carries out. No need for it to affect anything system-wise" -Vincent
                 */
                scCollection.find({status: { $in: ["approved","ongoing"]}}).toArray().then(docs => { 
                    if(docs.length > 0){
                        docs.forEach(val => {
                            var last_sc_date = val.next_sc_date;
                            var next_sc_date = moment(val.next_sc_date).add(val.months, 'months').toISOString();
                            var sub3days = moment(val.next_sc_date).subtract(3, 'days');
                            var diff = moment(new Date()).startOf('day').valueOf() - sub3days.valueOf();
                            var duration = moment.duration(diff, 'milliseconds');
                            var days = duration.asDays();
                            var status = "ongoing";
                            console.log("days",days);

                            if(days >= 0){
                                // notify emails
                                (val.emails||[]).forEach(to => {
                                    childPromise.push(transporter.sendMail({
                                        from: '"WRU Maintenance" <noreply@wru.ph>', // sender address
                                        to: to || `mariellepamaran@gmail.com`, // list of receivers
                                        subject: `Scheduled Checklist - ${val.vehicle}`, // Subject line
                                        text: emailTemplate(val,last_sc_date,next_sc_date),
                                        html: emailTemplate(val,last_sc_date,next_sc_date),
                                    }));
                                });
                                // last notif date = next_notif_date
                                // next_notif_date = next_notif_date + months
                                childPromise.push(scCollection.updateOne({_id: val._id}, {   
                                    $set: { next_sc_date, last_sc_date, status /*notified: true*/ }
                                })); 
                            }  
                        });
                        if(childPromise.length > 0){
                            Promise.all(childPromise).then(result => {
                                console.log("Promise:",result.toString());
                                areClientsDone(clientName);
                            }).catch(error => {
                                console.log("Error in Promise All:", error);
                                hasError = true;
                                areClientsDone(clientName);
                            });
                        } else {
                            res.status(200).send("OK");
                        }
                    } else {
                        res.status(200).send("OK");
                    }
                }).catch(error => {
                    console.log("Error in SC", error);
                    hasError = true;
                    areClientsDone(clientName);
                });
            },
            emailTemplate = function(obj,last_sc_date,next_sc_date){
                var nextScDateHTML = (next_sc_date) ? `<div>Next schedule will be after <b>${obj.months}</b> month/s, <b>${moment(next_sc_date).format("MMM DD, YYYY")}</b>.</div>` : "";
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
                                <div>This is a reminder of the Preventive Maintenance that is scheduled on <b>${moment(last_sc_date).format("MMM DD, YYYY")}</b>.</div>
                                ${nextScDateHTML}
                                <br>
                                <br>
                                <div>Thank you!</div>
                                <div><hr style="border: 0;border-top: 1px solid #eee;margin: 20px 0px;"></div>
                                <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${moment().format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                            </body>
                        </html>`;
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                if(done === true){
                    client.close();
                    res.status(hasError?500:200).send(hasError?"ERROR":"OK");
                }
            };

        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        console.log("Error",error);
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};