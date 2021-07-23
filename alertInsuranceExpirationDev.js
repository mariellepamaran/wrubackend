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

exports.alertInsuranceExpirationDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            childPromise = [],
            CLIENTS = {
                  "wilcon":null,
            },
            hasError = false,
            process = function(clientName){
                const db = client.db(`wm-${clientName}`),
                    insuranceCollection = db.collection('insurance'),
                    insuranceListCollection = db.collection('insurance_list'),
                    insuranceClassCollection = db.collection('insurance_class');

                insuranceListCollection.find({}).toArray().then(ilDocs => {
                    insuranceClassCollection.find({}).toArray().then(icDocs => {
                        insuranceCollection.find({}).toArray().then(docs => {
                            docs.forEach(val => {
                                var indexes = {};
                                (val.insurances||[]).forEach((iVal,i) => {
                                    var hasBeenNotifiedAtLeastOnce = false;
                                    function inXdays(notifiedKey,xDays){
                                        if(!iVal[notifiedKey]){
                                            // var testDate = "September 11, 2021, 12:00 AM";
                                            // checks if expiration date is greater than today's date
                                            if(moment(new Date(iVal.expiry_date)).valueOf() >= moment(new Date()).valueOf()){
                                                var inXMonthsDate = moment(new Date(iVal.expiry_date)).subtract(xDays, 'days').startOf('day');
                                                var diff = inXMonthsDate.valueOf() - moment(new Date()).startOf('day').valueOf();
                                                var duration = moment.duration(diff, 'milliseconds');
                                                var diffMonths = duration.asMonths();
                                                console.log("diffMonths",val._id,i,diffMonths);
                    
                                                if(diffMonths <= 0){
                                                    if(!hasBeenNotifiedAtLeastOnce){
                                                        hasBeenNotifiedAtLeastOnce = true;
                                                        var il = ilDocs.find(x => x._id.toString() == (iVal.insurance_list_id||"").toString()) || {};//
                                                        var ic = icDocs.find(x => x._id.toString() == (iVal.insurance_class_id||"").toString()) || {};//
                
                                                        indexes[xDays] = indexes[xDays] || [];
                                                        indexes[xDays].push(i);

                                                        // notify emails
                                                        (iVal.emails||[]).forEach(to => {
                                                            childPromise.push(transporter.sendMail({
                                                                from: '"WRU Maintenance" <noreply@wru.ph>', // sender address
                                                                to: to || `mariellepamaran@gmail.com`, // list of receivers
                                                                subject: `Insurance Expiry Notification | ${il.insurance} - ${val.platenum}`, // Subject line
                                                                text: emailTemplate(val,iVal,il,ic),
                                                                html: emailTemplate(val,iVal,il,ic),
                                                            }));
                                                        });
                                                    } else {
                                                        indexes[xDays] = indexes[xDays] || [];
                                                        indexes[xDays].push(i); 
                                                    }
                                                }  
                                            }
                                        }
                                    }
                                    inXdays("notified_30days",30);
                                    inXdays("notified_60days",60);
                                    inXdays("notified_90days",90);
                                });
                                function indexesXdays(notifiedKey,xDays){
                                    if(indexes[xDays] && indexes[xDays].length > 0){
                                        var set = {};
                                        indexes[xDays].forEach(i => {
                                            set[`insurances.${i}.${notifiedKey}`] = true;
                                        });
                                        childPromise.push(insuranceCollection.updateOne({ _id: ObjectId(val._id) },{ $set: set }));
                                    }
                                }
                                indexesXdays("notified_30days",30);
                                indexesXdays("notified_60days",60);
                                indexesXdays("notified_90days",90);
                            });
                            
                            if(childPromise.length > 0){
                                Promise.all(childPromise).then(result => {
                                    console.log("Promise:",result.toString());
                                    areClientsDone(clientName);
                                }).catch(error => {
                                    console.log('Error in Promise All: ',error);
                                    hasError = true;
                                    areClientsDone(clientName);
                                });
                            } else {
                                areClientsDone(clientName);
                            }
                        }).catch(error => {
                            console.log("Error Insurance",error);
                            hasError = true;
                            areClientsDone(clientName);
                        });
                    }).catch(error => {
                        console.log("Error IC",error);
                        hasError = true;
                        areClientsDone(clientName);
                    });
                }).catch(error => {
                    console.log("Error IL",error);
                    hasError = true;
                    areClientsDone(clientName);
                });
            },
            emailTemplate = function(obj,_in,il,ic){
                var expiry_date = moment(new Date(_in.expiry_date)).format("MMMM DD, YYYY");
                var insurance = il.insurance || "-";
                var i_class = ic.class || "-";
                var policy_no = _in.policy_no || "-";
                var vehicle_type = obj.vehicle_type || "-";
                var platenum = obj.platenum || "-";//


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
                                <div>A friendly reminder that the insurance for vehicle <b>${platenum}</b> is about to expire on <b>${expiry_date}</b>.</div>
                                <br>
                                <div>
                                    Insurance Details:<br>
                                    Insurance: ${insurance}<br>
                                    Class: ${i_class}<br>
                                    Policy No.: ${policy_no}<br>
                                    Vehicle Type: ${vehicle_type}<br>
                                    Plate Number: ${platenum}
                                </div>
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