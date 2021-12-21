/**
 * escalation
 * 
 * >> Send an email to selected users if the shipment's escalation level increased <<
 * 
 * This function looks through shipments and checks if specific status' escalation level has increased
 * 
 * Things to take note:
 *    > In Transit status is destination based. Meaning
 *    > Idling, Queueing, and Processing are origin based. 
 * 
 * Over Transit
 *    > Escalation 1 - delay > 0 && delay <= 1
 *    > Escalation 2 - delay > 1 && delay <= 3
 *    > Escalation 3 - delay > 3
 * 
 * FIX MEEEEEEEEEE
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const request = require('request');
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

exports.escalation = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    try {
        request({
            method: 'GET',
            url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/escalationDev`
        });
    } catch (error){
        console.log("Request Error",error);
    }

    // website link (production)
    var websiteLink = "https://wrudispatch.azurewebsites.net";

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
        const nowMs = now.valueOf(); // get current time in milliseconds

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri, { useUnifiedTopology: true });

        // list of clients. Key is usually the db name
        const CLIENTS = {
            "coket1":null,
            "wilcon":null,
        };
        const CLIENT_OPTIONS = {
            "coket1":{ pathName: "CokeT1", ot: "origin-based" },
            "wilcon":{ pathName: "Wilcon", overCICO: "startAt-startOfShift" },
        };

        // delay options. Minimum and maximum time for each delay/escalation level
        const delayOptions = {
            // Over Transit
            ot: {
                e1: { min: 0,   max: 1   },
                e2: { min: 1,   max: 3   },
                e3: { min: 3             },
            },
            // Long Queueing
            lq: {
                e1: { min: 0.5, max: 1   },
                e2: { min: 1,   max: 1.5 },
                e3: { min: 1.5           },
            },
            // Over CICO
            oc: {
                e1: { min: 0,   max: 1   },
                e2: { min: 1,   max: 3   },
                e3: { min: 3             },
            }
        };

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/


        /************** Functions **************/
        function process(clientName,pathName){
            // initialize database
            const db = client.db('wd-'+clientName);
            const notificationsCollection = db.collection('notifications');
            const dispatchCollection = db.collection('dispatch');
            const usersCollection = db.collection('users');
            const regionsCollection = db.collection('regions');
            const clustersCollection = db.collection('clusters');
            
            const otherDb = client.db(clientName);
            const geofencesCollection = otherDb.collection('geofences');
            const vehiclesCollection = otherDb.collection('vehicles');

            // extra function for objects
            const OBJECT = {
                sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
            };

            // retrieve all region data
            regionsCollection.find({}).toArray().then(rDocs => {
                // retrieve all cluster data
                clustersCollection.find({}).toArray().then(cDocs => {
                    // retrieve all geofence data
                    geofencesCollection.find({}).toArray().then(gDocs => {
                        // retrieve all vehicles
                        vehiclesCollection.find({}).toArray().then(vDocs => {
                            // retrieve dispatch entries if following conditions are met:
                            //   > status is NOT Plan, Assigned, Complete, or Incomplete
                            //   > escalation level did not reach max (level 3)
                            // also retrieve the route of each entry
                            dispatchCollection.aggregate([
                                {
                                    $match: {
                                        "status": {
                                            $nin: ["plan","assigned","complete","incomplete"]
                                        },
                                        "escalation3":{
                                            $nin: [true]
                                        }
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
                                { $unwind: "$route" }, // do not preserveNull. Route is required
                            ]).toArray().then(docs => {
    
                                // each number(key) represents the escalation level
                                const _ids = { 1: [], 2: [], 3: [] };
                                const siteTable = { 1: {}, 2: {}, 3: {} };
    
                                const hasDelay = {};
                                const assigned = {};
                                const emailDetails = [];
                                const notificationList = [];
                                const oSites = {};
                                const dSites = {};
                                const historyUpdate = {};
    
                                var usernames = [];
    
                                // function to get the 'first' or 'last' timestamp of the status sent
                                function getDateTime(doc,status,type="first"){
                                    const events_captured = OBJECT.sortByKey(doc.events_captured||{});
                                    var timestamp;
                                    Object.keys(events_captured).forEach(key => {
                                        if(events_captured[key] == status){
                                            if(type == "first" && !timestamp){
                                                timestamp = moment.tz(Number(key), undefined, timezone).valueOf();
                                            }
                                            if(type == "last"){
                                                timestamp = moment.tz(Number(key), undefined, timezone).valueOf();
                                            }
                                        }
                                    });
                                    return timestamp;
                                };
                                
                                if(docs.length > 0){
                                    // loop through to shipments
                                    docs.forEach(val => {
    
                                        // set default value so they're not null or undefined
                                        val.vehicle = vDocs.find(x => x._id == val.vehicle_id) || {};
                                        val.route = val.route || {}; // because of $unwind
                                        
                                        // take note on the 'o' and 'd' at the start of variables
                                        // 'o' - origin
                                        // 'd' - destination
    
                                        val.oGeofence = gDocs.find(x => (x._id||"").toString() == (val.origin_id||"").toString()) || {};
                                        val.dGeofence = gDocs.find(x => (x._id||"").toString() == (val.destination[0].location_id||"").toString()) || {};
                                        
                                        val.oCluster = cDocs.find(x => (x._id||"").toString() == (val.oGeofence.cluster_id||"").toString()) || {};
                                        val.dCluster = cDocs.find(x => (x._id||"").toString() == (val.dGeofence.cluster_id||"").toString()) || {};
                                        
                                        val.oRegion = rDocs.find(x => (x._id||"").toString() == (val.oGeofence.region_id||"").toString()) || {};
                                        val.dRegion = rDocs.find(x => (x._id||"").toString() == (val.dGeofence.region_id||"").toString()) || {};
                    
                                        // origin sites
                                        oSites[val.oGeofence.short_name] = oSites[val.oGeofence.short_name] || [];
                                        oSites[val.oGeofence.short_name].push(val);
    
                                        // destination sites
                                        dSites[val.dGeofence.short_name] = dSites[val.dGeofence.short_name] || [];
                                        dSites[val.dGeofence.short_name].push(val);
                                    });
    
                                    // function to check if shipment is delayed
                                    function checkForDelay(doc,delay_type,delay_text,statusArray,clusterBase,site,delayIdentified,calculateDelayAndTimelapse){
                                        // check whether shipment is delayed or not. Return value
                                        // to prevent duplicate of notification in queueingAtOrigin
                                        var isDelayed = false;
                                        
                                        // if shipment's status is in Array and it's not yet tagged as 'delay' from other delay type
                                        if(statusArray.includes(doc.status) && !delayIdentified){
    
                                            // get each escalation's min and max delay time
                                            const e1_delay = delayOptions[delay_type].e1;
                                            const e2_delay = delayOptions[delay_type].e2;
                                            const e3_delay = delayOptions[delay_type].e3;
                                        
                                            // get the last timestamp recorded for shipment's current status
                                            const statusTimestamp = getDateTime(doc,doc.status,"last");
    
                                            // get the difference of Now and In Transit timestamp (in milliseconds)
                                            var difference_ms = nowMs - statusTimestamp;
    
                                            // custom calculation for each delay type
                                            const calculatedData = calculateDelayAndTimelapse(difference_ms);
    
                                            // if the calculateDelayAndTimelapse() returned a 'difference_ms' field, overwrite 'difference_ms' to that value.
                                            calculatedData.difference_ms != undefined ? difference_ms = calculatedData.difference_ms : null;
    
                                            // basically if statusTimestamp and difference_ms is not less than 0
                                            if(statusTimestamp && difference_ms){
    
                                                // convert difference (in milliseconds) to decimal hour
                                                const timelapse = calculatedData.timelapse;
                                                // get the delay time (decimal hour)
                                                const delay = calculatedData.delay;
                                                // shipment's target time (depending on the delay type)
                                                const target_time = calculatedData.target_time;
    
                                                // print relevant data
                                                var relevantTime = "";
                                                (delay_type == "ot") ? relevantTime = doc.route.transit_time : null;
                                                (delay_type == "lq") ? relevantTime = difference_ms          : null;
                                                (delay_type == "oc") ? relevantTime = doc.oGeofence.cico     : null;
    
                                                console.log(
                                                    delay_type,
                                                    `ID: ${doc._id}`,
                                                    `Escalation 1: ${doc.escalation1}`,
                                                    `Escalation 2: ${doc.escalation2}`,
                                                    `Escalation 3: ${doc.escalation3}`,
                                                    `Relevant Time: ${relevantTime}`,
                                                    `Actual Timelapse: ${timelapse}`,
                                                    `Delay: ${delay}`,
                                                    `E1: ${(delay > e1_delay.min && delay <= e1_delay.max && doc.escalation1 != true)}`,
                                                    `E2: ${(delay > e2_delay.min && delay <= e2_delay.max && doc.escalation2 != true)}`,
                                                    `E3: ${(delay > e3_delay.min && doc.escalation3 != true)}`,
                                                );
                                                
                
                                                // Escalation 1
                                                if(delay > e1_delay.min && delay <= e1_delay.max && doc.escalation1 != true){
                                                    // add the shipment's ID in escalation 1
                                                    _ids[ 1 ].push(doc._id);
    
                                                    // tag TRUE to let this function that there is an Escalation 1 delay
                                                    hasDelay.escalation1 = true;
    
                                                    // get the usernames that are assigned for the shipment's geofence and escalation level
                                                    setPersonInCharge("escalation1",delay_type,doc);
    
                                                    // object to be saved
                                                    const obj = {
                                                        _id: doc._id,
                                                        delay_text,
                                                        delay_type,
                                                        site,
                                                        cluster: clusterBase == "origin" ? doc.oCluster.cluster : doc.dCluster.cluster,
                                                        vehicle: doc.vehicle.name,
                                                        trailer: doc.vehicle.Trailer || "-",
                                                        target_time,
                                                        actual_time_lapse: timelapse
                                                    };
    
                                                    // check which 'key' is used to save per delay type. (Origin or Destination)
                                                    // the 'key' will matter when sending the notification to recipients (who will be notified)
                                                    const _key_ = CLIENT_OPTIONS[clientName][delay_type] == "origin-based" ? doc.oGeofence.short_name : site;
                                                    
                                                    // note the '1'. This is escalation 1
                                                    /*
                                                        siteTable [ESCALATION_LEVEL] [ORIGIN_OR_DESTINATION] [DELAY_TYPE] = [ OBJECT1, OBJECT2 ]
    
                                                        or 
    
                                                        siteTable {
                                                            1: {
                                                                ORIGIN_OR_DESTINATION: {
                                                                    DELAY_TYPE(ot,lq,oc): [ OBJECT1, OBJECT2 ]
                                                                }
                                                            }
                                                        }
                                                    */
                                                    siteTable[ 1 ][_key_] = siteTable[ 1 ][_key_] || {};
                                                    (siteTable[ 1 ][_key_][delay_type])?siteTable[ 1 ][_key_][delay_type].push(obj):siteTable[ 1 ][_key_][delay_type] = [obj];
    
                                                    isDelayed = true;
                                                } 
                                                
                                                // Escalation 2
                                                else if(delay > e2_delay.min && delay <= e2_delay.max && doc.escalation2 != true){
                                                    // add the shipment's ID in escalation 2
                                                    _ids[ 2 ].push(doc._id);
    
                                                    // tag TRUE to let this function that there is an Escalation 2 delay
                                                    hasDelay.escalation2 = true;
    
                                                    // get the usernames that are assigned for the shipment's geofence and escalation level
                                                    setPersonInCharge("escalation2",delay_type,doc);
    
                                                    // escalation 2 should show escalation 1 remarks in the email
                                                    const remarks = doc.esc1_remarks || {};
                                                    const remarksHTML = [];
                                                    Object.keys(remarks).forEach(key => {
                                                        var value = remarks[key];
                                                        if(value.type == delay_type){
                                                            remarksHTML.push(`• ${value.remarks}`);
                                                        }
                                                    });
    
                                                    // object to be saved
                                                    const obj = {
                                                        _id: doc._id,
                                                        delay_text,
                                                        delay_type,
                                                        site,
                                                        cluster: clusterBase == "origin" ? doc.oCluster.cluster : doc.dCluster.cluster,
                                                        vehicle: doc.vehicle.name,
                                                        trailer: doc.vehicle.Trailer || "-",
                                                        target_time,
                                                        actual_time_lapse: timelapse,
                                                        remarks: remarksHTML.join("<br>")
                                                    };
    
                                                    // check which 'key' is used to save per delay type. (Origin or Destination)
                                                    // the 'key' will matter when sending the notification to recipients (who will be notified)
                                                    const _key_ = CLIENT_OPTIONS[clientName][delay_type] == "origin-based" ? doc.oGeofence.short_name : site;
    
                                                    // note the '2'. This is escalation 2
                                                    /*
                                                        siteTable [ESCALATION_LEVEL] [ORIGIN_OR_DESTINATION] [DELAY_TYPE] = [ OBJECT1, OBJECT2 ]
    
                                                        or 
    
                                                        siteTable {
                                                            2: {
                                                                ORIGIN_OR_DESTINATION: {
                                                                    DELAY_TYPE(ot,lq,oc): [ OBJECT1, OBJECT2 ]
                                                                }
                                                            }
                                                        }
                                                    */
                                                    siteTable[ 2 ][_key_] = siteTable[ 2 ][_key_] || {};
                                                    (siteTable[ 2 ][_key_][delay_type])?siteTable[ 2 ][_key_][delay_type].push(obj):siteTable[ 2 ][_key_][delay_type] = [obj];
    
                                                    isDelayed = true;
                                                } 
                                                
                                                // Escalation 3 
                                                else if(delay > e3_delay.min && doc.escalation3 != true){
                                                    // add the shipment's ID in escalation 2
                                                    _ids[ 3 ].push(doc._id);
    
                                                    // tag TRUE to let this function that there is an Escalation 3 delay
                                                    hasDelay.escalation3 = true;
    
                                                    // get the usernames that are assigned for the shipment's geofence and escalation level
                                                    setPersonInCharge("escalation3","ot",doc);
    
                                                    // escalation 3 should show escalation 1 & 2 remarks in the email
                                                    var remarksHTML = "";
    
                                                    // escalation 1
                                                    const esc1HTML = [];
                                                    const remarks_1 = doc.esc1_remarks || {};
                                                    Object.keys(remarks_1).forEach(key => {
                                                        const value = remarks_1[key];
                                                        if(value.type == "ot"){
                                                            esc1HTML.push(`• ${value.remarks}`);
                                                        }
                                                    });
    
                                                    // escalation 2
                                                    const esc2HTML = [];
                                                    const remarks_2 = doc.esc2_remarks || {};
                                                    Object.keys(remarks_2).forEach(key => {
                                                        const value = remarks_2[key];
                                                        if(value.type == "ot"){
                                                            esc2HTML.push(`• ${value.remarks}`);
                                                        }
                                                    });
    
                                                    // add remarks in HTML
                                                    if(esc1HTML.length > 0){
                                                        remarksHTML += `Escalation 1:<br>${esc1HTML.join("<br>")}`;
                                                    }
                                                    if(esc1HTML.length > 0 && esc2HTML.length > 0){
                                                        remarksHTML += `<br><br>`;
                                                    }
                                                    if(esc2HTML.length > 0){
                                                        remarksHTML += `Escalation 2:<br>${esc2HTML.join("<br>")}`;
                                                    }
                                                    
                                                    // object to be saved
                                                    const obj = {
                                                        _id: doc._id,
                                                        delay_text,
                                                        delay_type,
                                                        site,
                                                        cluster: clusterBase == "origin" ? doc.oCluster.cluster : doc.dCluster.cluster,
                                                        vehicle: doc.vehicle.name,
                                                        trailer: doc.vehicle.Trailer || "-",
                                                        target_time,
                                                        actual_time_lapse: timelapse,
                                                        remarks: remarksHTML
                                                    };
    
                                                    // check which 'key' is used to save per delay type. (Origin or Destination)
                                                    // the 'key' will matter when sending the notification to recipients (who will be notified)
                                                    const _key_ = CLIENT_OPTIONS[clientName][delay_type] == "origin-based" ? doc.oGeofence.short_name : site;
    
                                                    // note the '3'. This is escalation 3
                                                    /*
                                                        siteTable [ESCALATION_LEVEL] [ORIGIN_OR_DESTINATION] [DELAY_TYPE] = [ OBJECT1, OBJECT2 ]
    
                                                        or 
    
                                                        siteTable {
                                                            3: {
                                                                ORIGIN_OR_DESTINATION: {
                                                                    DELAY_TYPE(ot,lq,oc): [ OBJECT1, OBJECT2 ]
                                                                }
                                                            }
                                                        }
                                                    */
                                                    siteTable[ 3 ][_key_] = siteTable[ 3 ][_key_] || {};
                                                    (siteTable[ 3 ][_key_][delay_type])?siteTable[ 3 ][_key_][delay_type].push(obj):siteTable[ 3 ][_key_][delay_type] = [obj];
    
                                                    isDelayed = true;
                                                }
                                            }
                                        }
    
                                        // return true if shipment was delayed
                                        return isDelayed;
                                    }
    
                                    /**** Check for delay for each delay type */
    
                                    // loop through the destination sites 'dSites'
                                    Object.keys(dSites).forEach(key => {
                                        // loop through each 'dSites' shipment
                                        dSites[key].forEach(doc => {
                                            // remember that On Transit is destination based
                                            checkForDelay(doc,"ot","Over Transit",["in_transit"],"destination",key,undefined,(difference_ms) => {
                                                // convert ms to decimal hour
                                                const timelapse = decimalHours(difference_ms);
                                                const target_time = doc.route.transit_time;
                                                return {
                                                    timelapse,
                                                    delay: roundOff(timelapse - target_time), // get delay (in decimal hour)
                                                    target_time
                                                };
                                            });
                                        });
                                    });
    
                                    // loop through the origin sites 'oSites'
                                    Object.keys(oSites).forEach(key => {
                                        // loop through each 'oSites' shipment
                                        oSites[key].forEach(doc => {
                                            // remember that Long Queueing is origin based
                                            const hasQueueingDelay = checkForDelay(doc,"lq","Long Queueing",["queueingAtOrigin"],"origin",key,undefined,(difference_ms) => {
                                                // convert ms to decimal hour
                                                const timelapse = decimalHours(difference_ms);
                                                const target_time = 0.5; // by default, target time for long queueing is 30 minutes.
                                                return {
                                                    timelapse,
                                                    delay: timelapse, // for Long Queueing, delay time is the same as the time lapsed
                                                    target_time
                                                };
                                            });
    
                                            // remember that Over CICO is origin based
                                            checkForDelay(doc,"oc","Over CICO",["queueingAtOrigin","processingAtOrigin","idlingAtOrigin"],"origin",key,hasQueueingDelay,(difference_ms) => {
                                                // other clients prefer the start of CICO calculation on the start of the shift instead of the time the truck entered the geofence
                                                if(CLIENT_OPTIONS[clientName] && CLIENT_OPTIONS[clientName].overCICO == "startAt-startOfShift"){
                                                    // convert scheduled date to "MMM DD, YYYY" format
                                                    const scheduled_date = moment.tz(doc.scheduled_date, undefined, timezone).format(format.date);
                                                    // get the 'minimum' time schedule. Ex. 8:00 AM - 12:00 PM. Only get '8:00 AM'
                                                    const shift_schedule = (doc.shift_schedule||"").split(" - ")[0];
                                                    // merge scheduled_date and shift_schedule and get its timestamp in milliseconds
                                                    const startOfShift = moment.tz(scheduled_date + ", " + shift_schedule, "MMM DD, YYYY, h:mm A", "Asia/Manila").valueOf();
                                                    
                                                    // get difference in milliseconds
                                                    difference_ms = Math.abs(nowMs - startOfShift);
    
                                                    // just printing...
                                                    if(!startOfShift){
                                                        console.log("NO-SHIFT:",doc._id);
                                                    } else {
                                                        console.log("SHIFT!!:",doc._id,scheduled_date,shift_schedule,startOfShift,difference_ms,nowMs,moment.tz(scheduled_date + ", " + shift_schedule, "MMM DD, YYYY, h:mm A", "Asia/Manila").valueOf());
                                                    }
                                                }
                                                
                                                // convert ms to decimal hour
                                                const timelapse = decimalHours(difference_ms);
                                                const target_time = doc.oGeofence.cico;
                                                return {
                                                    difference_ms,
                                                    timelapse,
                                                    delay: roundOff(timelapse - target_time), // get delay (in milliseconds)
                                                    target_time
                                                };
                                            });
                                        });
                                    });
    
                                    /**** end Check for delay for each delay type */
    
    
                                    // check if there's at least 1 delay
                                    if(Object.keys(hasDelay).length > 0){
    
                                        // get list of all assigned person based on the usernames retrieved from previous function
                                        getAssignedPerson().then(_docs => {
                                            _docs = _docs || [];
    
                                            // function to check if there's a shipment delayed at the escalation level
                                            // add to email array the email data if there is a delay
                                            function checkifHasDelay(level,callback){
                                                
                                                if(hasDelay[`escalation${level}`] === true){
                                                    Object.keys(siteTable[ level ]).forEach(sKey => {
                                                        
                                                        assigned[sKey] = assigned[sKey] || {};
                                                        assigned[sKey][`escalation${level}`] = assigned[sKey][`escalation${level}`] || {};
        
                                                        Object.keys(siteTable[ level ][sKey]).forEach(sType => {
                                                            // assigned[short_name][escalation][type]
                                                            assigned[sKey][`escalation${level}`][sType] = assigned[sKey][`escalation${level}`][sType] || [];
        
                                                            if(assigned[sKey][`escalation${level}`][sType].length > 0){
                                                                
                                                                assigned[sKey][`escalation${level}`][sType].forEach(username => {
                                                                    const user = _docs.find(x => x._id == username);
                                                                    if(user && user.email){
                                                                        emailDetails.push({
                                                                            escalation: level,
                                                                            to: user.email,
                                                                            subject: `Escalation 0${level} at ${sKey}`,
                                                                            content: callback(user,siteTable[ level ][sKey][sType],level)
                                                                        });
                                                                    } else {
                                                                        callback({},siteTable[ level ][sKey][sType],level);
                                                                    }
                                                                });
                                                            } else {
                                                                callback({},siteTable[ level ][sKey][sType],level);
                                                            }
                                                        });
                                                    });
                                                }
                                            }
    
                                            checkifHasDelay(1,escalation1);
                                            checkifHasDelay(2,escalation2_3);
                                            checkifHasDelay(3,escalation2_3);
                                            
                                            // loop through mail list
                                            const childPromise = [];
                                            if(emailDetails.length > 0){
                                                emailDetails.forEach(val => {
                                                    if(val.to){
                                                        // send email
                                                        childPromise.push(transporter.sendMail({
                                                            from: '"WRU Dispatch" <noreply@wru.ph>', // sender address
                                                            to: val.to, // list of receivers
                                                            subject: val.subject, // Subject line
                                                            text: val.content,
                                                            html: val.content,
                                                        }));
                                                    }
                                                });
                                                if(childPromise.length > 0){
                                                    // promise...
                                                    Promise.all(childPromise).then(data => {
                                                        console.log("SEND DATA",JSON.stringify(data));
                                                        proceedToUpdate();
                                                    }).catch(error => {
                                                        console.log("Failed to send email.",error);
                                                        proceedToUpdate();
                                                    });
                                                } else {
                                                    proceedToUpdate();
                                                }
                                            } else {
                                                console.log("No assigned person.");
                                                proceedToUpdate();
                                            }
                                        });
                                    } else {
                                        isDone(clientName);
                                    }
                                } else {
                                    isDone(clientName);
                                }
                    
                                /*************** FUNCTIONS ***************/
                                // function that checks who are the person in charge for the geofence/cluster/region and
                                // for that delay type and level
                                function setPersonInCharge(escalation,type,doc){
                                    // get all data of region, cluster, and geofence
                                    var region = doc.oRegion;
                                    var cluster = doc.oCluster;
                                    var geofence = doc.oGeofence
    
                                    if(type == "ot"){
                                        region = doc.dRegion;
                                        cluster = doc.dCluster;
                                        geofence = doc.dGeofence;
                                        
                                        if(clientName == "coket1"){
                                            const basePlantGeofence = gDocs.find(x => x.short_name == doc.vehicle["Base Site"]);
                                            if(basePlantGeofence){
                                                geofence = basePlantGeofence;
                                                region = rDocs.find(x => (x._id||"").toString() == (geofence.region_id||"").toString()) || {};
                                                cluster = cDocs.find(x => (x._id||"").toString() == (geofence.cluster_id||"").toString()) || {};
                                            }
                                        }
                                    }
                                    // should be after all conditions
                                    const short_name = geofence.short_name;
    
                                    // if person-in-charge for the geofence is not yet set
                                    if(!assigned[short_name]){
    
                                        // get person-in-charge for region(rPIC), cluster(cPIC), and geofence(gPIC)
                                        const rPIC = region.person_in_charge || {};
                                        const cPIC = cluster.person_in_charge || {};
                                        const gPIC = geofence.person_in_charge || {};
    
                                        // store person-in-charge for escalation level
                                        const person_in_charge = {};
                
                                        function populateSelect2(_escalation_,_type_){
                                            // get person-in-charge for the escalation level. Also add default {} value so that it's not null or undefined
                                            rPIC[_escalation_] = rPIC[_escalation_] || {};
                                            cPIC[_escalation_] = cPIC[_escalation_] || {};
                                            gPIC[_escalation_] = gPIC[_escalation_] || {};
    
                                            person_in_charge[_escalation_] = person_in_charge[_escalation_] || {};
    
                                            // get the list of usersnames per escalation level and type
                                            // what it looks like:
                                            /**
                                                 person_in_charge {
                                                     escalation1: {
                                                         lq: [ array_of_usernames ],
                                                        ot: [ array_of_usernames ],
                                                        oc: [ array_of_usernames ],
                                                    },
                                                    escalation2: {
                                                        lq: [ array_of_usernames ],
                                                        ot: [ array_of_usernames ],
                                                        oc: [ array_of_usernames ],
                                                    },
                                                    escalation3: {
                                                        lq: [ array_of_usernames ],
                                                        ot: [ array_of_usernames ],
                                                        oc: [ array_of_usernames ],
                                                    }
                                                }
                                             */
                                            const rPICArr = ((rPIC[_escalation_][_type_] || []).length > 0) ? rPIC[_escalation_][_type_] : null;
                                            const cPICArr = ((cPIC[_escalation_][_type_] || []).length > 0) ? cPIC[_escalation_][_type_] : null;
                                            const gPICArr = ((gPIC[_escalation_][_type_] || []).length > 0) ? gPIC[_escalation_][_type_] : null;
                                            
                                            // Note:
                                            //   > If there's person-in-charge set for the region, that's it. Do not notify the person-in-charge set for cluster and geofence.
                                            //   > If there's NO person-in-charge set for region, check the cluster. If there's person-in-charge set for the cluster, that's it. Do not notify the person-in-charge set for geofence.
                                            //   > If there's NO person-in-charge set for region and cluster, check the geofence. If there's person-in-charge set for the geofence, that's it.
                                            //   > If there's NO person-in-charge set at all, default would be an empty array
    
                                            person_in_charge[_escalation_][_type_] = gPICArr || cPICArr || rPICArr || [];
                                        }
                                        populateSelect2("escalation1","lq");
                                        populateSelect2("escalation1","oc");
                                        populateSelect2("escalation1","ot");
                                        populateSelect2("escalation2","lq");
                                        populateSelect2("escalation2","oc");
                                        populateSelect2("escalation2","ot");
                                        populateSelect2("escalation3","lq");
                                        populateSelect2("escalation3","oc");
                                        populateSelect2("escalation3","ot");
                
                                        assigned[short_name] = person_in_charge;
                                    }
                                    console.log("setPersonInCharge",escalation,type,short_name,assigned[short_name][escalation][type]);
    
                                    // merge usernames
                                    usernames = usernames.concat(assigned[short_name][escalation][type]);
                                }
                                // function that does all the updates. Update for notification db, update for dispatch db.
                                function proceedToUpdate(){
                                    if(Object.keys(_ids).length > 0){
                                        
                                        // array of promises
                                        const childPromise = [];
    
                                        // add the notifications to WD db
                                        (notificationList.length > 0) ? childPromise.push(notificationsCollection.insertMany(notificationList)) : null;
                                
                                        // loop through
                                        Object.keys(_ids).forEach(function(key) {
                                            // check if shipment/dispatch ID is in notification list
                                            const notif = (notificationList||[]).find(x => _ids[key].includes(x.dispatch_id));
                                            
                                            if(notif){
                                                const level = Number(key);
                                                if(_ids[level].length > 0){
                                                    const _set = {};
                                                    _set[`escalation${level}`] = true;
                                                    // update dispatch entry escalation level. 
                                                    childPromise.push(dispatchCollection.updateMany({"_id": {$in: _ids[level]}}, { $set: _set })); 
                                                }
                                            }
                                        }); 
                                        // loop 
                                        Object.keys(historyUpdate).forEach(function(key) {
                                            const _set = {};
                                            _set[`history.${nowMs}`] = key;
                                            
                                            // update dispatch entry history
                                            // like: "Over Transit - Escalation 2"
                                            childPromise.push(dispatchCollection.updateMany({"_id": {$in: historyUpdate[key]}}, {   
                                                $set: _set
                                            })); 
                                        });
                                        
                                        // print print...
                                        console.log("NList:",JSON.stringify(notificationList),childPromise.length,"IDS:",JSON.stringify(_ids));
                                        if(childPromise.length > 0){
                                            // promise
                                            Promise.all(childPromise).then(docsUM => {
                                                console.log(`docsUM: `,JSON.stringify(docsUM));
                                                isDone(clientName);
                                            }).catch(error => {
                                                isDone(clientName);
                                                console.log(`Error Promise: `,JSON.stringify(error));
                                            });
                                        } else {
                                            console.log("No childpromise");
                                            isDone(clientName);
                                        }
                                    } else {
                                        isDone(clientName);
                                    }
                                }
                                // function that gets assigned person's details from users db.
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
    
                                // convert millisecond to decimal hour
                                function decimalHours(ms){
                                    var def = "0";
                                    if(ms && ms >=0){
                                        def = (ms/3600)/1000; // milliseconds to decimal hours
                                    }
                                    return def;
                                }
    
                                // converts decimal hour to "HH:MM" format. Ex. 1.5 hours => 01:30 (or 1 hour and 30 minutes)
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
    
                                // get roundoff value of number
                                function roundOff(value,decimal_place){
                                    decimal_place = (decimal_place != null) ? decimal_place : 2;
                                    return Number(Math.round((value)+`e${decimal_place}`)+`e-${decimal_place}`);
                                }
    
                                // remove duplicate values from array
                                function removeDuplicates(arr) {
                                    let unique = {};
                                    arr.forEach(function(i) { (!unique[i]) ? unique[i] = true : null;  });
                                    return Object.keys(unique);
                                }
    
                                // check whether number is Odd or Even
                                function oddOrEven(i){
                                    return ( i & 1 ) ? "odd" : "even";
                                }
                                
                                // returns the html or body of email (Escalation 1)
                                function escalation1(user={},tbl){
                                    // declare variables
                                    const escalation = 1;
                                    const date = now.format("MMMM DD, YYYY, h:mm A");
                                    // const linkData = { _ids: [], clientId: clientName, escalation: 1, username: user._id || "-", name: user.name || "" }; // new version
                                    const linkData = { _ids: [], escalation, for: "notifications" };
                                    const summary = {};
    
                                    var detailsHTML = "";
                                    var summaryHTML = "";
                                    var site = "-"; // site is also used for html
    
                                    // loop through the objects stored per escalation level (relevant dispatch entry data)
                                    tbl.forEach((val,i) => {
                                        // get the site name
                                        site = val.site;
    
                                        // store the dispatch ids
                                        // linkData._ids.push({            // new version
                                        //     _id: val._id,
                                        //     delay: val.delay_text,
                                        //     type: val.delay_type
                                        // });
                                        linkData._ids.push(val._id);
    
                                        // add to array the notification data
                                        notificationList.push({
                                            type: "delay",
                                            escalation,
                                            delay_type: val.delay_text,
                                            timelapse: roundOff(val.actual_time_lapse),
                                            site,
                                            timestamp: now.toISOString(),
                                            dispatch_id: val._id,
                                            username: user._id,
                                            read: false
                                        });
    
                                        // add row to html table
                                        detailsHTML += `<tr class="${oddOrEven(i)}">
                                                            <td>${val.delay_text}</td>
                                                            <td>${val.vehicle}</td>
                                                            <td>${val.trailer}</td>
                                                            <td>${val._id}</td>
                                                            <td>${hoursMinutes(val.target_time)}</td>
                                                            <td>${hoursMinutes(val.actual_time_lapse)}</td>
                                                        </tr>`;
                                        
                                        // store history data updates
                                        const index = `${val.delay_text} - Escalation ${escalation}`;
                                        historyUpdate[index] = historyUpdate[index] || [];
                                        historyUpdate[index].push(val._id);
    
                                        // store and calculate delay data and average timelapse and target time
                                        summary[val.delay_type] = summary[val.delay_type] || {
                                            delay_text: val.delay_text,
                                            units: 1,
                                            ave_target_time: val.target_time,
                                            ave_time_lapse: val.actual_time_lapse
                                        };
                                        const ave_time_lapse = (summary[val.delay_type].ave_time_lapse + val.actual_time_lapse)/2;
                                        const ave_target_time = (summary[val.delay_type].ave_target_time + val.target_time)/2;
    
                                        summary[val.delay_type].ave_target_time = ave_target_time;
                                        summary[val.delay_type].ave_time_lapse = ave_time_lapse;
                                        summary[val.delay_type].units ++;
                                    });
                                    
                                    // loop summary and add row to table
                                    Object.keys(summary).forEach((key,i) => {
                                        const val = summary[key];
                                        summaryHTML += `<tr class="${oddOrEven(i)}">
                                                            <td>${val.delay_text}</td>
                                                            <td>${val.units}</td>
                                                            <td>${hoursMinutes(val.ave_target_time)}</td>
                                                            <td>${hoursMinutes(val.ave_time_lapse)}</td>
                                                        </tr>`;
                                    });
                                    
                                    // convert object to string
                                    const baseString = JSON.stringify(linkData);
                                    // encode string base64. Equivalend to window.btoa()
                                    const encodedString = Buffer.from(baseString, 'binary').toString('base64');
                                    const link = `<br><div>Please click this <a href="${websiteLink}/${pathName}?data=${encodedString}#notifications" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
                                    // new version
                                    // const link = `<br><div>Please click this <a href="${websiteLink}/remarks?data=${encodedString}" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
    
                                    // return the html for the email
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
                                                    <div>Good day <b>${user.name||"-"}</b>,</div>
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
                                                    <div style="font-style: italic;color: #a0aeba;padding-top: 11px;font-weight: 100;border-top: 1px solid #eee;margin-top: 15px;">This is a system generated email. Please do not reply.</div>
                                                    <div><hr style="border: 0;border-top: 1px solid #eee;margin: 12px 0px 20px 0px;"></div>
                                                    <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${now.format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                                </body>
                                            </html>`;
                                }
    
                                // returns the html or body of email (Escalation 2 & 3)
                                function escalation2_3(user={},tbl,escalation){
                                    // declare variables
                                    const date = now.format("MMMM DD, YYYY, h:mm A");
                                    const linkData = { _ids: [], escalation, for: "notifications" };
                                    // const linkData = { _ids: [], clientId: clientName, escalation, username: user._id || "-", name: user.name || "" }; // new version
                                    const summary = {};
                                   
                                    var detailsHTML = "";
                                    var summaryHTML = "";
                                    var site = null;
                                    var cluster = null;
    
                                    tbl.forEach((val,i) => {
                                        // save site name and cluster
                                        if(site == null){
                                            site = val.site;
                                            cluster = val.cluster || "-";
                                        }
    
                                        // store the dispatch ids
                                        // linkData._ids.push({
                                        //     _id: val._id,
                                        //     delay: val.delay_text,
                                        //     type: val.delay_type
                                        // });
                                        linkData._ids.push(val._id);
                                        
                                        // add to array the notification data
                                        notificationList.push({
                                            type: "delay",
                                            escalation,
                                            delay_type: val.delay_text,
                                            timelapse: roundOff(val.actual_time_lapse),
                                            site,
                                            timestamp: now.toISOString(),
                                            dispatch_id: val._id,
                                            username: user._id || "-",
                                            read: false
                                        });
    
                                        // for escalation 2 and 3, the email show the remarks from previous escalations
                                        const remarks = (val.remarks) ? val.remarks : `<span class="no-remarks">No remarks received</span>`;
                                        // add row to table
                                        detailsHTML += `<tr class="${oddOrEven(i)}">
                                                            <td>${val.delay_text}</td>
                                                            <td>${cluster||"-"}</td>
                                                            <td>${val.vehicle}</td>
                                                            <td>${val.trailer}</td>
                                                            <td>${val._id}</td>
                                                            <td>${hoursMinutes(val.target_time)}</td>
                                                            <td>${hoursMinutes(val.actual_time_lapse)}</td>
                                                            <td class="text-left">${remarks}</td>
                                                        </tr>`;
    
                                        // store history data updates
                                        const index = `${val.delay_text} - Escalation ${escalation}`;
                                        historyUpdate[index] = historyUpdate[index] || [];
                                        historyUpdate[index].push(val._id);
    
                                        // store and calculate delay data and average timelapse and target time
                                        const _key = `${val.delay_type}${cluster}`;
                                        summary[_key] = summary[_key] || {
                                            delay_text: val.delay_text,
                                            units: 1,
                                            ave_target_time: val.target_time,
                                            ave_time_lapse: val.actual_time_lapse
                                        };
                                        
                                        const ave_time_lapse = (summary[_key].ave_time_lapse + val.actual_time_lapse)/2;
                                        const ave_target_time = (summary[_key].ave_target_time + val.target_time)/2;
    
                                        summary[_key].ave_target_time = ave_target_time;
                                        summary[_key].ave_time_lapse = ave_time_lapse;
                                        summary[_key].units ++;
                                    });
    
                                    // loop summary and add row to table
                                    Object.keys(summary).forEach((key,i) => {
                                        const val = summary[key];
                                        summaryHTML += `<tr class="${oddOrEven(i)}"ss>
                                                            <td>${val.delay_text}</td>
                                                            <td>${cluster||"-"}</td>
                                                            <td>${val.units}</td>
                                                            <td>${hoursMinutes(val.ave_target_time)}</td>
                                                            <td>${hoursMinutes(val.ave_time_lapse)}</td>
                                                        </tr>`;
                                    });
                                    
                                    // convert object to string
                                    const baseString = JSON.stringify(linkData);
                                    // encode string base64. Equivalend to window.btoa()
                                    const encodedString = Buffer.from(baseString, 'binary').toString('base64');
                                    const link = `<br><div>Please click this <a href="${websiteLink}/${pathName}?data=${encodedString}#notifications" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
                                    // new version
                                    // const link = `<br><div>Please click this <a href="${websiteLink}/remarks?data=${encodedString}" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
                                    
                                    // return the html for the email
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
                                                        .text-left {
                                                            text-align: left !important;
                                                        }
                                                    </style>
                                                </head>
                                                <body>
                                                    <div>Good day <b>${user.name||"-"}</b>,</div>
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
                                                    ${link}
                                                    <br>
                                                    <div>Thank you!</div>
                                                    <div style="font-style: italic;color: #a0aeba;padding-top: 11px;font-weight: 100;border-top: 1px solid #eee;margin-top: 15px;">This is a system generated email. Please do not reply.</div>
                                                    <div><hr style="border: 0;border-top: 1px solid #eee;margin: 12px 0px 20px 0px;"></div>
                                                    <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${now.format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                                </body>
                                            </html>`;
                                }
                                /*************** END FUNCTIONS ***************/
                            }).catch(error => {
                                isDone(clientName,"Dispatch",error);
                            }); 
                        }).catch(error => {
                            isDone(clientName,"Geofence",error);
                        }); 
                    }).catch(error => {
                        isDone(clientName,"Geofence",error);
                    }); 
                }).catch(error => {
                    isDone(clientName,"Cluster",error);
                }); 
            }).catch(error => {
                isDone(clientName,"Region",error);
            }); 
            
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
            process(key,CLIENT_OPTIONS[key].pathName);
        });
        /************** END OF PROCESS **************/
    }).catch(function(error) {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};