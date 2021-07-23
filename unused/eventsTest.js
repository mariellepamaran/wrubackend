const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const sgMail = require('@sendgrid/mail');
const moment = require('moment');

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.eventsTest = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/");
        // params_value.shift();

        const client = yield mongodb.MongoClient.connect(uri),
              db = client.db('wd-coket1'),
              commandNotifierCollection = db.collection('command_notifier'),
              dispatchCollection = db.collection('dispatch'),
              usersCollection = db.collection('users'),
              locationsCollection = db.collection('locations');

        console.log("Method:",method);
        console.log("Body:",body);
        console.log("Query:",query);

        var GEOFENCE_NAME = null;

        if(method === "DELETE"){
            var _id = params_value[0];
            if(_id && _id.trim() === ""){
                res.status(400).send('Error: Missing parameters');
            } else {
                var docs = yield commandNotifierCollection.deleteOne({"_id":ObjectId(_id)});
                closeConnection(docs);
            }
        } else {
            var temp = query.GEOFENCE_NAME.split(" - ");
            GEOFENCE_NAME = temp[0];
            dispatchCollection.find({
                "vehicle.username":query.USER_USERNAME, 
                $or: [ 
                        { "origin": {$regex : GEOFENCE_NAME} }, 
                        { 
                            "destination": {
                                $elemMatch: {
                                    "location": {$regex : GEOFENCE_NAME}
                                }
                            } 
                        } 
                    ],
                "status": {
                    $nin: ["complete","incomplete"]
                }
            }).toArray().then(docs => {
                var _ids = {
                    in_transit: [],
                    queueing: [],
                    : [],
                    complete: []
                },
                isUpdateDone = {
                    in_transit: false,
                    queueing: false,
                    : false,
                    complete: false
                },
                hasDelay = {},
                assigned = {},
                escalation01Tbl = [],
                escalation02Tbl = [],
                escalation03Tbl = [];

                
                var shipment_number = [],
                emailDetails = [];
                // affectedCount = 0,
                // affectedCountWithEmail = 0;

                /** DECIMAL HOURS
                    Actual Time - Transit - In transit to Queueing
                    Actual Time - Queuing - Queueing to 
                    Actual Time -  -  to Complete
                */
                
                /****
                    Inside Geofence - 
                    Inside Geofence - Queueing
                    Outside Distribution Center
                    Outside Geofence - 
                
                    ✓ Saved entry -> PLAN
                    ✓ Outside Distribution Center -> IN TRANSIT
                    ✓ Inside Geofence - Queueing -> QUEUEING
                    ✓ Inside Geofence -  -> 
                    ✓ Outside Geofence -  -> COMPLETE
                */
                
                if(docs.length > 0){
                    for(var i = 0; i < docs.length; i++){
                        console.log("START:",i,docs.length);
                        var doc = docs[i],
                            isOrigin = (query.GEOFENCE_NAME.indexOf(doc.origin) > -1),
                            isDestination = (query.GEOFENCE_NAME.indexOf(doc.destination[0].location) > -1);
                        
                        if(query.RULE_NAME == "Inside Geofence" && ["plan","dispatch"].includes(doc.status) && isOrigin === true && query.stage == "end"){
                            _ids.in_transit.push(ObjectId(doc._id));
                            shipment_number.push(doc.shipment_number);

                            // console.log(i,docs.length);
                            // isDoneGettingAssignedPerson(i==(docs.length-1));
                        } else if(["Inside Geofence","Inside Geofence - Queueing"].includes(query.RULE_NAME) && doc.status == "in_transit" && isDestination === true && query.stage == "start"){
                            _ids.queueing.push(ObjectId(doc._id));
                            shipment_number.push(doc.shipment_number);

                            // console.log(i,docs.length);
                            // isDoneGettingAssignedPerson(i==(docs.length-1));
                        } else if(query.RULE_NAME == "Inside Geofence - " && ["queueing","in_transit"].includes(doc.status) && isDestination === true && query.stage == "start"){
                            _ids..push(ObjectId(doc._id));
                            shipment_number.push(doc.shipment_number);

                            // affectedCount++;
                            
                            // OVER TRANSIT
                            if(doc.event_time.in_transit != null && doc.event_time.queueing != null){
                                var in_transit = Math.abs(new Date(doc.event_time.in_transit).getTime() - new Date(doc.event_time.queueing).getTime()),
                                    queueing = Math.abs(new Date(doc.event_time.queueing).getTime() - new Date().getTime()),
                                    actual_time_lapse = Number(decimalHours(in_transit,"0")) + Number(decimalHours(queueing,"0")),
                                    delay = roundOff(actual_time_lapse-doc.destination[0].cico);
                                
                                if(delay > 0 && delay <= 1){
                                    hasDelay.escalation01 = true;
                                    escalation01Tbl.push({
                                        delay_type: "Over Transit",
                                        shipment_number: doc.shipment_number,
                                        actual_time_lapse
                                    });
                                    // send to: Warehouse Manager (DC)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `Transit Time delayed by ${delay} hours`,
                                    //                 content: escalation01()
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                } else if(delay > 1 && delay <= 3){
                                    hasDelay.escalation02 = true;
                                    escalation02Tbl.push({
                                        delay_type: "Over Transit",
                                        shipment_number: doc.shipment_number,
                                        actual_time_lapse,
                                        remarks: doc.remarks
                                    });

                                    // send to: Operations Manager (Cluster) (per cluster ??????????)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `Transit Time delayed by ${delay} hours`,
                                    //                 content: "<b>Should be sent to: Operations Manager (Cluster)</b>"
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                } else if(delay > 3){
                                    hasDelay.escalation03 = true;
                                    escalation03Tbl.push({
                                        delay_type: "Over Transit",
                                        shipment_number: doc.shipment_number,
                                        actual_time_lapse,
                                        remarks: doc.remarks
                                    });
                                    // send to: Distribution Manager (Region)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `Transit Time delayed by ${delay} hours`,
                                    //                 content: "<b>Should be sent to: Distribution Manager (Region)</b>"
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                }
                            } else {
                                // affectedCount--;
                                // console.log(i,docs.length);
                                // isDoneGettingAssignedPerson(i==(docs.length-1));
                            }
                        } else if(query.RULE_NAME == "Inside Geofence - " && doc.status == "" && isDestination === true && query.stage == "end"){
                            _ids.complete.push(ObjectId(doc._id));
                            shipment_number.push(doc.shipment_number);
                            
                            // OVER CICO
                            if(doc.event_time.queueing != null && doc.event_time. != null){
                                var queueing = Math.abs(new Date(doc.event_time.queueing).getTime() - new Date(doc.event_time.).getTime()),
                                     = Math.abs(new Date(doc.event_time.).getTime() - new Date().getTime()),
                                    actual_time_lapse = Number(decimalHours(queueing,"0")) + Number(decimalHours(,"0")),
                                    delay = roundOff(actual_time_lapse-doc.destination[0].cico);
                                
                                // affectedCount++;
                                
                                if(delay > 0 && delay <= 1){
                                    hasDelay.escalation01 = true;
                                    escalation01Tbl.push({
                                        delay_type: "Over CICO",
                                        shipment_number: doc.shipment_number,
                                        _id: doc._id.toString(),
                                        actual_time_lapse
                                    });
                                    // send to: Warehouse Manager (DC)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `CICO Time delayed by ${delay} hours`,
                                    //                 content: escalation01()
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                } else if(delay > 1 && delay <= 3){
                                    hasDelay.escalation02 = true;
                                    escalation02Tbl.push({
                                        delay_type: "Over CICO",
                                        shipment_number: doc.shipment_number,
                                        actual_time_lapse,
                                        remarks: doc.remarks
                                    });

                                    // send to: Operations Manager (Cluster) (per cluster ??????????)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `CICO Time delayed by ${delay} hours`,
                                    //                 content: "<b>Should be sent to: Operations Manager (Cluster)</b>"
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                } else if(delay > 3){
                                    hasDelay.escalation03 = true;
                                    escalation03Tbl.push({
                                        delay_type: "Over CICO",
                                        shipment_number: doc.shipment_number,
                                        actual_time_lapse,
                                        remarks: doc.remarks
                                    });

                                    // send to: Distribution Manager (Region)
                                    // getAssignedPerson().then(_docs => {
                                    //     if(_docs.length > 0){
                                    //         _docs.forEach(val => {
                                    //             emailDetails.push({
                                    //                 to: val.email,
                                    //                 subject: `CICO Time delayed by ${delay} hours`,
                                    //                 content: "<b>Should be sent to: Distribution Manager (Region)</b>"
                                    //             });
                                    //         });
                                    //     }
                                    //     affectedCountWithEmail++;
                                    //     console.log(i,docs.length);
                                    //     // made it (i==(docs.length-1) || i==docs.length) because, when loop end before the promise, variable i already undergone i++
                                    //     isDoneGettingAssignedPerson((i==(docs.length-1) || i==docs.length));
                                    // });
                                }
                            } else {
                                // affectedCount--;
                                // console.log(i,docs.length);
                                // isDoneGettingAssignedPerson(i==(docs.length-1));
                            }
                        } else {
                            // console.log(i,docs.length);
                            // isDoneGettingAssignedPerson(i==(docs.length-1));
                        }
                    }

                    if(Object.keys(hasDelay).length > 0){
                        getAssignedPerson().then(_docs => {
                            if(_docs.length > 0){
                                if(hasDelay.escalation01 === true){
                                    assigned.dc.forEach(username => {
                                        var user = _docs.find(x => x.username == username);
                                        emailDetails.push({
                                            to: user.email,
                                            subject: `Escalation 01`,
                                            content: escalation01(user.name)
                                        });
                                    });
                                }
                                if(hasDelay.escalation02 === true){
                                    assigned.cluster.forEach(username => {
                                        var user = _docs.find(x => x.username == username);
                                        emailDetails.push({
                                            to: user.email,
                                            subject: `Escalation 02`,
                                            content: escalation02_03(user.name,escalation02Tbl)
                                        });
                                    });
                                }
                                
                                if(hasDelay.escalation03 === true){
                                    assigned.region.forEach(username => {
                                        var user = _docs.find(x => x.username == username);
                                        emailDetails.push({
                                            to: user.email,
                                            subject: `Escalation 03`,
                                            content: escalation02_03(user.name,escalation03Tbl)
                                        });
                                    });
                                }
                            }
                            proceedToInsert();
                        });
                    } else {
                        proceedToInsert();
                    }
                } else {
                    closeConnection();
                }

                /*************** FUNCTIONS ***************/
                // function isDoneGettingAssignedPerson(loopDone){
                //     console.log(loopDone,affectedCount,affectedCountWithEmail);
                //     if(loopDone === true && affectedCount == affectedCountWithEmail){
                //         proceedToInsert();
                //     }
                // }
                function proceedToInsert(){
                    if(shipment_number.length > 0){
                        commandNotifierCollection.insertOne({
                            notification:JSON.stringify(query),
                            timestamp:new Date().toISOString(),
                            shipment_number
                        }).then(() => {
                            proceedToUpdate();
                        }).catch(error => {
                            console.log(error);
                            client.close();
                            res.status(500).send('Error: ' + error.toString());
                        });
                    } else {
                        proceedToUpdate();
                    }
                }
                function proceedToUpdate(){
                    if(Object.keys(_ids).length > 0){
                        Object.keys(_ids).forEach(function(key) {
                            performUpdate(key);
                        });
                    } else {
                        closeConnection();
                    }
                    function performUpdate(status){
                        if(_ids[status].length > 0){
                            var set = { "status": status, };
                            set[`event_time.${status}`] = new Date().toISOString();
        
                            dispatchCollection.updateMany({"_id": {$in: _ids[status]}}, {   
                                $set: set
                            }).then(docsUM => {
                                console.log(`docsUM: [${status}]: `,docsUM);
                                isUpdateDone[status] = true;
                                isProcessDone();
                            }).catch(error => {
                                isUpdateDone[status] = true;
                                isProcessDone();
                                console.log(`Error Updating: [${status}]: `,error);
                            });
                        } else {
                            console.log(`None [${status}]`);
                            isUpdateDone[status] = true;
                            isProcessDone();
                        }
                    }
                    function isProcessDone(){
                        var updateDone = true;
                        Object.keys(isUpdateDone).forEach(function(key) {
                            (isUpdateDone[key] === false) ? updateDone = false : null;
                        });
                        if(updateDone === true){
                            var sentCount = 0;
                            if(emailDetails.length > 0){
                                emailDetails.forEach(val => {
                                    sendEmail(val).then(() => {
                                        sentCount++;
                                        if(emailDetails.length == sentCount){
                                            closeConnection();
                                        }
                                    }).catch(error => {
                                        console.log("Email not sent:",error);
                                        res.status(500).send();
                                    });
                                });
                            } else {
                                closeConnection();
                            }
                        }
                    }
                }
                function getAssignedPerson(){
                    return new Promise((resolve,reject) => {
                        var usernames = [];
                        locationsCollection.find({"cluster.dc" : {$elemMatch: {"short_name" : GEOFENCE_NAME}}}).toArray().then(lDocs => {
                            if(lDocs.length > 0){
                                var lDoc = lDocs[0],
                                    cluster1 = lDoc.cluster,
                                    cluster = cluster1.find(x => x.dc.some(y => y.short_name === GEOFENCE_NAME)),
                                    dc = cluster.dc[0] || {};

                                assigned.region = lDoc.assigned || [];
                                assigned.cluster = cluster.assigned || [];
                                assigned.dc = dc.assigned || [];
                                usernames = usernames.concat(assigned.region);
                                usernames = usernames.concat(assigned.cluster);
                                usernames = usernames.concat(assigned.dc);
                                
                                usersCollection.find({username:{ $in : usernames}}).toArray().then(docs => {
                                    resolve(docs);
                                }).catch(error => {
                                    console.log("Unable to get assigned person:",error);
                                    resolve([]);
                                });
                            } else {
                                resolve([]);
                            }
                        }).catch(error => {
                            console.log("Unable to get location:",error);
                            resolve([]);
                        });
                    });
                }
                function sendEmail(details){
                    return new Promise((resolve,reject) => {
                        sgMail.setApiKey(`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`);
                        const msg = {
                        to: details.to || `marielle.firstshoshin@gmail.com`,
                        from: `WRU Dispatch <mariellepamaran@gmail.com>`,
                        subject: details.subject,
                        text: details.content,
                        html: details.content,
                        };
                        sgMail.send(msg).then(docs => {
                        console.log("Successfully sent to:",details.to);
                        resolve();
                        }).catch(error => {
                        console.log("Email not sent:",error);
                        reject();
                        });
                    });
                }
                function decimalHours(milliseconds,dc){
                    dc = dc==null?"-":dc;
                    if(milliseconds){
                        var seconds = secondsToDecimalHour(milliseconds/1000);
                        dc = (seconds) ? seconds : "0";
                    }
                    return dc;
                }
                function roundOff(value,decimal_place){
                    decimal_place = (decimal_place != null) ? decimal_place : 2;
                    return Number(Math.round((value)+`e${decimal_place}`)+`e-${decimal_place}`);
                }
                function secondsToDecimalHour(seconds){
                    seconds = Number(seconds);
                    var h = Math.floor(seconds % (3600*24) / 3600);
                    var m = Math.floor(seconds % 3600 / 60);
                    var hundrs = {
                        0: 0.00,
                        1: 0.02,
                        2: 0.03,
                        3: 0.05,
                        4: 0.07,
                        5: 0.08,
                        6: 0.10,
                        7: 0.12,
                        8: 0.13,
                        9: 0.15,
                        10: 0.17,
                        11: 0.18,
                        12: 0.20,
                        13: 0.22,
                        14: 0.23,
                        15: 0.25,
                        16: 0.27,
                        17: 0.28,
                        18: 0.30,
                        19: 0.32,
                        20: 0.33,
                        21: 0.35,
                        22: 0.37,
                        23: 0.38,
                        24: 0.40,
                        25: 0.42,
                        26: 0.43,
                        27: 0.45,
                        28: 0.47,
                        29: 0.48,
                        30: 0.50,
                        31: 0.52,
                        32: 0.53,
                        33: 0.55,
                        34: 0.57, 
                        35: 0.58,
                        36: 0.60,
                        37: 0.62,
                        38: 0.63,
                        39: 0.65,
                        40: 0.67, 
                        41: 0.68, 
                        42: 0.70, 
                        43: 0.72, 
                        44: 0.73, 
                        45: 0.75, 
                        46: 0.77, 
                        47: 0.78, 
                        48: 0.80, 
                        49: 0.82, 
                        50: 0.83, 
                        51: 0.85,
                        52: 0.87, 
                        53: 0.88, 
                        54: 0.90, 
                        55: 0.92,
                        56: 0.93,
                        57: 0.95,
                        58: 0.97, 
                        59: 0.98,
                        60: 1.00
                    };
                    return h+hundrs[m];
                }
                function escalation01(recipient){
                    var date = moment(new Date(query["EVENT_TIME"])).format("MMMM DD, YYYY, h:mm A"),
                        link = "",
                        linkData = [],
                        detailsHTML = "",
                        summary = {},
                        summaryHTML = "";
                    escalation01Tbl.forEach(val => {
                        linkData.push({
                            _id: val._id,
                            shipment_number: val.shipment_number
                        });
                        detailsHTML += `<tr>
                                            <td>${val.delay_type}</td>
                                            <td>${query["ASSIGNED_VEHICLE_NAME"]}</td>
                                            <td>${val.shipment_number}</td>
                                            <td>${roundOff(val.actual_time_lapse)} hrs</td>
                                        </tr>`;
                        if(summary[val.delay_type]){
                            var ave_time_lapse = (summary[val.delay_type].ave_time_lapse + val.actual_time_lapse)/2;
                            summary[val.delay_type].ave_time_lapse = ave_time_lapse;
                            summary[val.delay_type].units ++;
                        } else {
                            summary[val.delay_type] = {
                                delay_type: val.delay_type,
                                units: 1,
                                ave_time_lapse: val.actual_time_lapse
                            };
                        }
                    });
                    var delay_type = "";
                    Object.keys(summary).forEach(key => {
                        var val = summary[key];
                        summaryHTML += `<tr>
                                            <td>${val.delay_type}</td>
                                            <td>${val.units}</td>
                                            <td>${roundOff(val.ave_time_lapse)} hrs</td>
                                        </tr>`;
                        delay_type = val.delay_type;
                    });
                    if(delay_type == "Over CICO") {
                        var baseString = JSON.stringify(linkData),
                            encodedString = Buffer.from(baseString, 'binary').toString('base64');
                        link = `<br><div>Please click this <a href="https://wru-dev-rbagv.mongodbstitch.com/CokeT1/remarks/?data=${encodedString}" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
                    }
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
                                            text-align: center;
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
                                    <div>Good day <b>${recipient}</b>,</div>
                                    <br>
                                    <div>As of <b>${date}</b>, below are the summary of concerned units in <b>${query["Site"]}</b>.</div>
                                    <br>
                                    <b>Summary:</b>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Delay Type</th>
                                                <th>No. of Units</th>
                                                <th>Ave. Time-lapse</th>
                                            </tr>
                                        </thead>
                                        <tbody>${summaryHTML}</tbody>
                                    </table>
                                    <br>
                                    <b>Details:</b>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Delay Type</th>
                                                <th>Plate Number</th>
                                                <th>Shipment Number</th>
                                                <th>Actual Time-lapse</th>
                                            </tr>
                                        </thead>
                                        <tbody>${detailsHTML}</tbody>
                                    </table>
                                    ${link}
                                    <br>
                                    <div>Thank you!</div>
                                </body>
                            </html>`;
                }
                function escalation02_03(recipient,tbl){
                    var date = moment(new Date(query["EVENT_TIME"])).format("MMMM DD, YYYY, h:mm A"),
                        detailsHTML = "",
                        summary = {},
                        summaryHTML = "";
                    tbl.forEach(val => {
                        var remarks = (val.remarks)?val.remarks:`<span class="no-remarks">No remarks received</span>`;
                        detailsHTML += `<tr>
                                            <td>${val.delay_type}</td>
                                            <td>${query["Cluster"]}</td>
                                            <td>${query["ASSIGNED_VEHICLE_NAME"]}</td>
                                            <td>${val.shipment_number}</td>
                                            <td>${roundOff(val.actual_time_lapse)} hrs</td>
                                            <td>${remarks}</td>
                                        </tr>`;
                                        
                        if(summary[val.delay_type]){
                            var ave_time_lapse = (summary[val.delay_type].ave_time_lapse + val.actual_time_lapse)/2;
                            summary[val.delay_type].ave_time_lapse = ave_time_lapse;
                            summary[val.delay_type].units ++;
                        } else {
                            summary[val.delay_type] = {
                                delay_type: val.delay_type,
                                units: 1,
                                ave_time_lapse: val.actual_time_lapse
                            };
                        }
                    });
                    Object.keys(summary).forEach(key => {
                        var val = summary[key];
                        summaryHTML += `<tr>
                                            <td>${val.delay_type}</td>
                                            <td>${query["Cluster"]}</td>
                                            <td>${val.units}</td>
                                            <td>${roundOff(val.ave_time_lapse)} hrs</td>
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
                                            text-align: center;
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
                                        .no-remarks {
                                            color: red;
                                            font-weight: bold;;
                                        }
                                    </style>
                                </head>
                                <body>
                                    <div>Good day <b>${recipient}</b>,</div>
                                    <br>
                                    <div>As of <b>${date}</b>, below are the summary of concerned units in <b>${query["Site"]}</b>.</div>
                                    <br>
                                    <b>Summary:</b>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Delay Type</th>
                                                <th>Cluster</th>
                                                <th>No. of Units</th>
                                                <th>Ave. Time-lapse</th>
                                            </tr>
                                        </thead>
                                        <tbody>${summaryHTML}</tbody>
                                    </table>
                                    <br>
                                    <b>Details:</b>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Delay Type</th>
                                                <th>Cluster</th>
                                                <th>Plate Number</th>
                                                <th>Shipment Number</th>
                                                <th>Actual Time-lapse</th>
                                                <th>Remarks</th>
                                            </tr>
                                        </thead>
                                        <tbody>${detailsHTML}</tbody>
                                    </table>
                                    <br>
                                    <div>Thank you!</div>
                                </body>
                            </html>`;
                }
                function closeConnection(docs){
                    console.log("Docs:",docs);
                    client.close();
                    res.status(200).send("OK");
                }
                /*************** END FUNCTIONS ***************/
            }).catch(error => {
                console.log(error);
                client.close();
                res.status(500).send('Error: ' + error.toString());
            });            
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error: ' + error.toString());
    });
};