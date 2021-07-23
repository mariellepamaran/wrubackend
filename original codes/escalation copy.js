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

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.escalation = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

                    
        // var deleteMe = [];

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                "coket1":{pathName: "CokeT1"},
                "wilcon":{pathName: "Wilcon"},
            },
            process = function(clientName,pathName){
                const db = client.db(`wd-${clientName}`),
                      notificationsCollection = db.collection('notifications'),
                      dispatchCollection = db.collection('dispatch'),
                      usersCollection = db.collection('users');
      
                dispatchCollection.aggregate([
                    {
                        $match: {
                            "status": {
                                $nin: ["plan","dispatch","complete","incomplete"]
                            },
                            "escalation3":{
                                $nin: [true]
                            }
                        }
                    },
                    { 
                        $lookup: {
                            from: 'geofences',
                            localField: 'destination.0.location_id',
                            foreignField: '_id',
                            as: 'geofence',
                        }
                    },
                    { $unwind: "$geofence" }, // do not preserveNull. geofence is required
                    // { $unwind: { path: "$geofence", preserveNullAndEmptyArrays: true } },
                    { 
                        $lookup: {
                            from: 'clusters',
                            let: { 
                                geofence: "$geofence", 
                            },
                            pipeline: [
                                {
                                    $match: { 
                                        $expr: { 
                                            $eq: ["$_id","$$geofence.cluster_id"]
                                        } 
                                    }
                                },
                            ],
                            as: 'cluster',
                        }
                    },
                    { 
                        $lookup: {
                            from: 'regions',
                            let: { 
                                geofence: "$geofence", 
                            },
                            pipeline: [
                                {
                                    $match: { 
                                        $expr: { 
                                            $eq: ["$_id","$$geofence.region_id"]
                                        } 
                                    }
                                },
                            ],
                            as: 'region',
                        }
                    },
                    { 
                        $lookup: {
                            from: 'routes',
                            localField: 'route',
                            foreignField: '_id',
                            as: 'route',
                        }
                    },
                    { 
                        $lookup: {
                            from: 'vehicles',
                            localField: 'vehicle_id',
                            foreignField: '_id',
                            as: 'vehicle',
                        }
                    },
                    // { $unwind: { path: "$cluster", preserveNullAndEmptyArrays: true } },
                    // { $unwind: { path: "$region", preserveNullAndEmptyArrays: true } },
                    { $unwind: "$vehicle" }, // do not preserveNull. cluster is required
                    { $unwind: "$cluster" }, // do not preserveNull. cluster is required
                    { $unwind: "$region" }, // do not preserveNull. region is required
                    { $unwind: "$route" }, // do not preserveNull. Route is required
                ]).toArray().then(docs => {
                    var _ids = {
                            1: [],
                            2: [],
                            3: []
                        },
                        hasDelay = {},
                        assigned = {region:{},cluster:{},geofence:{}},
                        emailDetails = [],
                        usernames = [],
                        notificationList = [],
                        sites = {},
                        siteTable = {1:{},2:{},3:{}};
                    
                    if(docs.length > 0){
                        for(var i = 0; i < docs.length; i++){
                            var doc = docs[i];
                            doc.geofence = doc.geofence || {}; // because of $unwind
                            doc.cluster = doc.cluster || {}; // because of $unwind
                            doc.region = doc.region || {}; // because of $unwind
                            doc.route = doc.route || {}; // because of $unwind

                            // console.log("000GEOFENCE000",JSON.stringify(doc.geofence));
                            // console.log("000CLUSTER000",JSON.stringify(doc.cluster));
                            // console.log("000REGION000",JSON.stringify(doc.region));
        
                            if(sites[doc.geofence.short_name]){
                                sites[doc.geofence.short_name].push(doc);
                            } else {
                                sites[doc.geofence.short_name] = [doc];
                            }
                        }
        
                        Object.keys(sites).forEach(key => {
                            sites[key].forEach(doc => {
                                var delayIdentified = false; // to prevent duplicate of notification in queueingAtDestination
                                if(doc.status == "in_transit"){
                                    // OVER TRANSIT
                                    if(doc.event_time && doc.event_time.in_transit != null){
                                        var transit_time = getTimestamp() - getTimestamp(doc.event_time.in_transit),
                                            actual_time_lapse = decimalHours(transit_time),
                                            delay = roundOff(actual_time_lapse-doc.route.transit_time);
                                        console.log("I",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,doc.route.transit_time,actual_time_lapse,delay,(delay > 0 && delay <= 1 && doc.escalation1 != true),(delay > 1 && delay <= 3 && doc.escalation2 != true),(delay > 3 && doc.escalation3 != true));
        
                                        if(delay > 0 && delay <= 1 && doc.escalation1 != true){
                                            _ids[1].push(doc._id);
                                            hasDelay.escalation01 = true;
                                            var obj = {
                                                _id: doc._id,
                                                delay_text: "Over Transit",
                                                delay_type: "over_transit",
                                                site:key,
                                                // region_id: doc.region._id,
                                                cluster: doc.cluster.cluster,
                                                vehicle: doc.vehicle.name,
                                                trailer: doc.vehicle.Trailer || "-",
                                                target_time: doc.route.transit_time,
                                                actual_time_lapse
                                            };
                                            (siteTable[1][key])?siteTable[1][key].push(obj):siteTable[1][key] = [obj];
                                        } else if(delay > 1 && delay <= 3 && doc.escalation2 != true){
                                            _ids[2].push(doc._id);
                                            hasDelay.escalation02 = true;
                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Over Transit",
                                                    delay_type: "over_transit",
                                                    target_time: doc.route.transit_time,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["over_transit"]
                                                };
                                            (siteTable[2][key])?siteTable[2][key].push(obj):siteTable[2][key] = [obj];
                                        } else if(delay > 3 && doc.escalation3 != true){
                                            _ids[3].push(doc._id);
                                            hasDelay.escalation03 = true;
                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Over Transit",
                                                    delay_type: "over_transit",
                                                    target_time: doc.route.transit_time,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["over_transit"]
                                                };
                                            (siteTable[3][key])?siteTable[3][key].push(obj):siteTable[3][key] = [obj];
                                        }
                                    }
                                }
                                if(doc.status == "queueingAtDestination"){
                                    // LONG QUEUEING
                                    if(doc.event_time && doc.event_time.queueingAtDestination != null){
                                        var queueing_time = getTimestamp() - getTimestamp(doc.event_time.queueingAtDestination),
                                            actual_time_lapse = decimalHours(queueing_time),
                                            target_time = 0.5;
                                        console.log("Q",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,queueing_time,actual_time_lapse,(actual_time_lapse > 0.5 && actual_time_lapse <= 1 && doc.escalation1 != true),(actual_time_lapse > 1 && actual_time_lapse <= 1.5 && doc.escalation2 != true),(actual_time_lapse > 1.5 && doc.escalation3 != true));
        
                                        if(actual_time_lapse > 0.5 && actual_time_lapse <= 1 && doc.escalation1 != true){
                                            _ids[1].push(doc._id);
                                            hasDelay.escalation01 = true;
                                            var obj = {
                                                _id: doc._id,
                                                delay_text: "Long Queueing",
                                                delay_type: "long_queueing",
                                                target_time,
                                                site:key,
                                                // region_id: doc.region._id,
                                                cluster: doc.cluster.cluster,
                                                vehicle: doc.vehicle.name,
                                                trailer: doc.vehicle.Trailer || "-",
                                                actual_time_lapse
                                            };
                                            (siteTable[1][key])?siteTable[1][key].push(obj):siteTable[1][key] = [obj];
                                            delayIdentified = true;
                                        } else if(actual_time_lapse > 1 && actual_time_lapse <= 1.5 && doc.escalation2 != true){
                                            _ids[2].push(doc._id);
                                            hasDelay.escalation02 = true;
                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Long Queueing",
                                                    delay_type: "long_queueing",
                                                    target_time,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["long_queueing"]
                                                };
                                            (siteTable[2][key])?siteTable[2][key].push(obj):siteTable[2][key] = [obj];
                                            delayIdentified = true;
                                        } else if(actual_time_lapse > 1.5 && doc.escalation3 != true){
                                            _ids[3].push(doc._id);
                                            hasDelay.escalation03 = true;
                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Long Queueing",
                                                    delay_type: "long_queueing",
                                                    target_time,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["long_queueing"]
                                                };
                                            (siteTable[3][key])?siteTable[3][key].push(obj):siteTable[3][key] = [obj];
                                            delayIdentified = true;
                                        }
                                    }
                                }
                                if(["queueingAtDestination","processingAtDestination"].includes(doc.status) && !delayIdentified){
                                    // OVER CICO
                                    if(doc.event_time && (doc.event_time.processingAtDestination != null || doc.event_time.queueingAtDestination != null)){
                                        var cico_time = getTimestamp() - getTimestamp(doc.event_time.processingAtDestination || doc.event_time.queueingAtDestination),
                                            actual_time_lapse = decimalHours(cico_time),
                                            delay = roundOff(actual_time_lapse-doc.geofence.cico);
                                        console.log("P",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,doc.geofence.cico,actual_time_lapse,delay,(delay > 0 && delay <= 1 && doc.escalation1 != true),(delay > 1 && delay <= 3 && doc.escalation2 != true),(delay > 3 && doc.escalation3 != true));
        
                                        if(delay > 0 && delay <= 1 && doc.escalation1 != true){
                                            _ids[1].push(doc._id);
                                            hasDelay.escalation01 = true;

                                            var gPIC = setPersonInCharge("geofence",doc.geofence.short_name);
                                            usernames = usernames.concat(gPIC);

                                            var obj = {
                                                _id: doc._id,
                                                delay_text: "Over CICO",
                                                delay_type: "over_cico",
                                                site:key,
                                                // region_id: doc.region._id,
                                                cluster: doc.cluster.cluster,
                                                vehicle: doc.vehicle.name,
                                                trailer: doc.vehicle.Trailer || "-",
                                                target_time: doc.geofence.cico,
                                                actual_time_lapse
                                            };
                                            (siteTable[1][key])?siteTable[1][key].push(obj):siteTable[1][key] = [obj];
                                        } else if(delay > 1 && delay <= 3 && doc.escalation2 != true){
                                            _ids[2].push(doc._id);
                                            hasDelay.escalation02 = true;

                                            var cPIC = setPersonInCharge("cluster",doc.geofence.short_name);
                                            usernames = usernames.concat(cPIC);

                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Over CICO",
                                                    delay_type: "over_cico",
                                                    target_time: doc.geofence.cico,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["over_cico"]
                                                };
                                            (siteTable[2][key])?siteTable[2][key].push(obj):siteTable[2][key] = [obj];
                                        } else if(delay > 3 && doc.escalation3 != true){
                                            _ids[3].push(doc._id);
                                            hasDelay.escalation03 = true;
                                            
                                            var rPIC = setPersonInCharge("region",doc.geofence.short_name);
                                            usernames = usernames.concat(rPIC);

                                            var _remarks = doc.remarks || {},
                                                obj = {
                                                    _id: doc._id,
                                                    delay_text: "Over CICO",
                                                    delay_type: "over_cico",
                                                    target_time: doc.geofence.cico,
                                                    actual_time_lapse,
                                                    site:key,
                                                    // region_id: doc.region._id,
                                                    cluster: doc.cluster.cluster,
                                                    vehicle: doc.vehicle.name,
                                                    trailer: doc.vehicle.Trailer || "-",
                                                    remarks: _remarks["over_cico"]
                                                };
                                            (siteTable[3][key])?siteTable[3][key].push(obj):siteTable[3][key] = [obj];
                                        }
                                    }
                                }
                            });
                        });
                        if(Object.keys(hasDelay).length > 0){
                            getAssignedPerson().then(_docs => {
                                if(_docs.length > 0){
                                    if(hasDelay.escalation01 === true){
                                        Object.keys(siteTable[1]).forEach(sKey => {
                                            assigned.geofence[sKey] = assigned.geofence[sKey] || [];
                                            assigned.geofence[sKey].forEach(username => {
                                                var user = _docs.find(x => x._id == username);
                                                if(user && user.email){
                                                    emailDetails.push({
                                                        escalation: 1,
                                                        to: user.email,
                                                        subject: `Escalation 01 at ${sKey}`,
                                                        content: escalation01(user,siteTable[1][sKey])
                                                    });
                                                }
                                            });
                                        });
                                    }
                                    if(hasDelay.escalation02 === true){
                                        Object.keys(siteTable[2]).forEach(sKey => {
                                            assigned.cluster[sKey] = assigned.cluster[sKey] || [];
                                            assigned.cluster[sKey].forEach(username => {
                                                var user = _docs.find(x => x._id == username);
                                                if(user && user.email){
                                                    emailDetails.push({
                                                        escalation: 2,
                                                        to: user.email,
                                                        subject: `Escalation 02 at ${sKey}`,
                                                        content: escalation02_03(user,siteTable[2][sKey],2)
                                                    });
                                                }
                                            });
                                        });
                                    }
                                    if(hasDelay.escalation03 === true){
                                        Object.keys(siteTable[3]).forEach(sKey => {
                                            assigned.region[sKey] = assigned.region[sKey] || [];
                                            assigned.region[sKey].forEach(username => {
                                                var user = _docs.find(x => x._id == username);
                                                if(user && user.email){
                                                    emailDetails.push({
                                                        escalation: 3,
                                                        to: user.email,
                                                        subject: `Escalation 03 at ${sKey}`,
                                                        content: escalation02_03(user,siteTable[3][sKey],3)
                                                    });
                                                }
                                            });
                                        });
                                    }
                                }
                                loopThroughMailDetails();
                            });
                        } else {
                            areClientsDone(clientName);
                        }
                    } else {
                        areClientsDone(clientName);
                    }
        
                    /*************** FUNCTIONS ***************/
                    function setPersonInCharge(type,short_name){
                        if(!assigned[type][short_name]){
                            assigned[type][short_name] = doc[type].person_in_charge || [];
                        }
                        console.log("setPersonInCharge",type,short_name,assigned[type][short_name]);
                        return assigned[type][short_name];
                    }
                    function proceedToUpdate(){
                        if(Object.keys(_ids).length > 0){
                            var childPromise = [];
                            (notificationList.length > 0) ? childPromise.push(notificationsCollection.insertMany(notificationList)) : null;
                    
                            Object.keys(_ids).forEach(function(key) {
                                if(notificationList && notificationList.find(x => _ids[key].includes(x.dispatch_id))){
                                    var escalation = Number(key);
                                    if(_ids[escalation].length > 0){
                                        var _set = {};
                                        _set[`escalation${escalation}`] = true;
                                        childPromise.push(dispatchCollection.updateMany({"_id": {$in: _ids[escalation]}}, {   
                                            $set: _set
                                        })); 
                                    }
                                }
                            });
                            console.log("NList:",JSON.stringify(notificationList),childPromise.length,"IDS:",JSON.stringify(_ids));
                            if(childPromise.length > 0){
                                Promise.all(childPromise).then(docsUM => {
                                    console.log(`docsUM: `,JSON.stringify(docsUM));
                                    areClientsDone(clientName);
                                }).catch(error => {
                                    areClientsDone(clientName);
                                    console.log(`Error Promise: `,JSON.stringify(error));
                                });
                            } else {
                                console.log("No childpromise");
                                areClientsDone(clientName);
                            }
                        } else {
                            areClientsDone(clientName);
                        }
                    }
                    function getAssignedPerson(){
                        return new Promise((resolve,reject) => {
                            usernames = removeDuplicates(usernames);
                            if(usernames.length > 0){
                                usersCollection.find({_id:{ $in : usernames}}).toArray().then(docs => {
                                    resolve(docs);
                                }).catch(error => {
                                    console.log("Unable to get assigned person:",JSON.stringify(error));
                                    resolve([]);
                                });
                            } else {
                                resolve([]);
                            }
                        });
                    }
                    function loopThroughMailDetails(){
                        var childPromise = [];
                        if(emailDetails.length > 0){
                            emailDetails.forEach(val => {
                                // deleteMe.push(val.to);
                                childPromise.push(transporter.sendMail({
                                    from: '"WRU Dispatch" <noreply@wru.ph>', // sender address
                                    // to: `mariellepamaran@gmail.com`, // list of receivers
                                    to: val.to || `mariellepamaran@gmail.com`, // list of receivers
                                    subject: val.subject, // Subject line
                                    text: val.content,
                                    html: val.content,
                                }));
                            });
                            Promise.all(childPromise).then(data => {
                                console.log("SEND DATA",JSON.stringify(data));
                                proceedToUpdate();
                            }).catch(error => {
                                console.log("Failed to send email.");
                                proceedToUpdate();
                            });
                        } else {
                            console.log("No assigned person.");
                            proceedToUpdate();
                        }
                    }
                    function decimalHours(ms){
                        var def = "0";
                        if(ms && ms >=0){
                            def = (ms/3600)/1000; // milliseconds to decimal hours
                        }
                        return def;
                    }
                    function hoursMinutes(dh,def){
                        def = def==null?"00:00":def;
                        if(dh){
                            dh = Number(dh);
                
                            var hour = dh.toString().split(".")[0], // convert decimal hour to HH:MM
                                minute = JSON.stringify(Math.round((dh % 1)*60)).split(".")[0];
                            if(hour.length < 2) hour = '0' + hour;
                            if(minute.length < 2) minute = '0' + minute;
                            def = `${hour}:${minute}`;
                        }
                        return def;
                    }
                    function getTimestamp(date){
                        date = date || new Date();
                        return moment(date).valueOf();
                    }
                    function roundOff(value,decimal_place){
                        decimal_place = (decimal_place != null) ? decimal_place : 2;
                        return Number(Math.round((value)+`e${decimal_place}`)+`e-${decimal_place}`);
                    }
                    function removeDuplicates(arr) {
                        let unique = {};
                        arr.forEach(function(i) {
                            if(!unique[i]) {
                            unique[i] = true;
                            }
                        });
                        return Object.keys(unique);
                    }
                    function escalation01(user,tbl){
                        var date = moment(new Date()).format("MMMM DD, YYYY, h:mm A"),
                            link = "",
                            linkData = {_ids:[],for:"notifications"},
                            detailsHTML = "",
                            summary = {},
                            summaryHTML = "",
                            site = "-",
                            oddOrEven = function(i){
                                return ( i & 1 ) ? "odd" : "even";
                            };
                        tbl.forEach((val,i) => {
                            site = val.site;
                            linkData._ids.push(val._id);
                            notificationList.push({
                                type: "delay",
                                escalation: 1,
                                delay_type: val.delay_text,
                                timelapse: roundOff(val.actual_time_lapse),
                                site,
                                // region_id: val.region_id,
                                timestamp: moment(new Date()).toISOString(),
                                dispatch_id: val._id,
                                // vehicle: val.vehicle,
                                username: user._id,
                                read: false
                            });
                            detailsHTML += `<tr class="${oddOrEven(i)}">
                                                <td>${val.delay_text}</td>
                                                <td>${val.vehicle}</td>
                                                <td>${val.trailer}</td>
                                                <td>${val._id}</td>
                                                <td>${hoursMinutes(val.target_time)}</td>
                                                <td>${hoursMinutes(val.actual_time_lapse)}</td>
                                            </tr>`;
                            if(summary[val.delay_type]){
                                var ave_time_lapse = (summary[val.delay_type].ave_time_lapse + val.actual_time_lapse)/2,
                                    ave_target_time = (summary[val.delay_type].ave_target_time + val.target_time)/2;
                                summary[val.delay_type].ave_target_time = ave_target_time;
                                summary[val.delay_type].ave_time_lapse = ave_time_lapse;
                                summary[val.delay_type].units ++;
                            } else {
                                summary[val.delay_type] = {
                                    delay_text: val.delay_text,
                                    units: 1,
                                    ave_target_time: val.target_time,
                                    ave_time_lapse: val.actual_time_lapse
                                };
                            }
                        });
                        var delay_text = "";
                        Object.keys(summary).forEach((key,i) => {
                            var val = summary[key];
                            summaryHTML += `<tr class="${oddOrEven(i)}">
                                                <td>${val.delay_text}</td>
                                                <td>${val.units}</td>
                                                <td>${hoursMinutes(val.ave_target_time)}</td>
                                                <td>${hoursMinutes(val.ave_time_lapse)}</td>
                                            </tr>`;
                            delay_text = val.delay_text;
                        });
                        var baseString = JSON.stringify(linkData),
                            encodedString = Buffer.from(baseString, 'binary').toString('base64');
                            // `https://secure-unison-275408.df.r.appspot.com/?data=${encodedString}#notifications`
                            link = `<br><div>Please click this <a href="https://wrudispatch.azurewebsites.net/${pathName}?data=${encodedString}#notifications" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
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
                                            .even {
                                                background-color: #e0e0e0;
                                            }
                                            .odd {
                                                background-color: #f0f0f0;
                                            }
                                        </style>
                                    </head>
                                    <body>
                                        <div>Good day <b>${user.name}</b>,</div>
                                        <br>
                                        <div>As of <b>${date}</b>, below are the summary of concerned units in <b>${site}</b>.</div>
                                        <br>
                                        <b>Summary:</b>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Delay Type</th>
                                                    <th>No. of Units</th>
                                                    <th>Ave. Target Time</th>
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
                                                    <th>Trailer Number</th>
                                                    <th>Shipment Number</th>
                                                    <th>Target Time</th>
                                                    <th>Actual Time-lapse</th>
                                                </tr>
                                            </thead>
                                            <tbody>${detailsHTML}</tbody>
                                        </table>
                                        ${link}
                                        <br>
                                        <div>Thank you!</div>
                                        <div><hr style="border: 0;border-top: 1px solid #eee;margin: 20px 0px;"></div>
                                        <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                    </body>
                                </html>`;
                    }
                    function escalation02_03(user,tbl,escalation){
                        var date = moment(new Date()).format("MMMM DD, YYYY, h:mm A"),
                            detailsHTML = "",
                            summary = {},
                            summaryHTML = "",
                            site = null,
                            cluster = null,
                            oddOrEven = function(i){
                                return ( i & 1 ) ? "odd" : "even";
                            };
                        tbl.forEach((val,i) => {
                            if(site == null){
                                site = val.site;
                                cluster = val.cluster;
                            }
                            notificationList.push({
                                type: "delay",
                                escalation,
                                delay_type: val.delay_text,
                                timelapse: roundOff(val.actual_time_lapse),
                                site,
                                // region_id: val.region_id,
                                timestamp: moment(new Date()).toISOString(),
                                dispatch_id: val._id,
                                // vehicle: val.vehicle,
                                username: user._id,
                                read: false
                            });
                            var remarks = (val.remarks)?val.remarks:`<span class="no-remarks">No remarks received</span>`;
                            detailsHTML += `<tr class="${oddOrEven(i)}">
                                                <td>${val.delay_text}</td>
                                                <td>${cluster}</td>
                                                <td>${val.vehicle}</td>
                                                <td>${val.trailer}</td>
                                                <td>${val._id}</td>
                                                <td>${hoursMinutes(val.target_time)}</td>
                                                <td>${hoursMinutes(val.actual_time_lapse)}</td>
                                                <td>${remarks}</td>
                                            </tr>`;
                            var _key = `${val.delay_type}${cluster}`;
                            if(summary[_key]){
                                var ave_time_lapse = (summary[_key].ave_time_lapse + val.actual_time_lapse)/2,
                                    ave_target_time = (summary[_key].ave_target_time + val.target_time)/2;
                                summary[_key].ave_target_time = ave_target_time;
                                summary[_key].ave_time_lapse = ave_time_lapse;
                                summary[_key].units ++;
                            } else {
                                summary[_key] = {
                                    delay_text: val.delay_text,
                                    units: 1,
                                    ave_target_time: val.target_time,
                                    ave_time_lapse: val.actual_time_lapse
                                };
                            }
                        });
                        Object.keys(summary).forEach((key,i) => {
                            var val = summary[key];
                            summaryHTML += `<tr class="${oddOrEven(i)}"ss>
                                                <td>${val.delay_text}</td>
                                                <td>${cluster}</td>
                                                <td>${val.units}</td>
                                                <td>${hoursMinutes(val.ave_target_time)}</td>
                                                <td>${hoursMinutes(val.ave_time_lapse)}</td>
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
                                            .even {
                                                background-color: #e0e0e0;
                                            }
                                            .odd {
                                                background-color: #f0f0f0;
                                            }
                                            .no-remarks {
                                                color: #c41d1d;
                                                font-weight: bold;;
                                            }
                                        </style>
                                    </head>
                                    <body>
                                        <div>Good day <b>${user.name}</b>,</div>
                                        <br>
                                        <div>As of <b>${date}</b>, below are the summary of concerned units in <b>${site}</b>.</div>
                                        <br>
                                        <b>Summary:</b>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Delay Type</th>
                                                    <th>Cluster</th>
                                                    <th>No. of Units</th>
                                                    <th>Ave. Target Time</th>
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
                                                    <th>Trailer Number</th>
                                                    <th>Shipment Number</th>
                                                    <th>Target Time</th>
                                                    <th>Actual Time-lapse</th>
                                                    <th>Remarks</th>
                                                </tr>
                                            </thead>
                                            <tbody>${detailsHTML}</tbody>
                                        </table>
                                        <br>
                                        <div>Thank you!</div>
                                        <div><hr style="border: 0;border-top: 1px solid #eee;margin: 20px 0px;"></div>
                                        <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                    </body>
                                </html>`;
                    }
                    /*************** END FUNCTIONS ***************/
                }).catch(error => {
                    console.log(JSON.stringify(error));
                    client.close();
                    res.status(500).send('Error: ' + JSON.stringify(error));
                }); 
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                if(done === true){
                    client.close();
                    res.status(200).send("OK");
                }
            };

        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            var pathName = CLIENTS[key].pathName;
            CLIENTS[key] = null;
            process(key,pathName);
        });
        /************** END OF PROCESS **************/
    }).catch(function(error) {
        console.log(JSON.stringify(error));
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};