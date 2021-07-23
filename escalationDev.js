const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const defaultUser = {
    _id: "wru_marielle",
    email: "mariellepamaran@gmail.com",
    name: "Marielle Pamaran"
}; // escalation will only be added to database if there is at least one person the escalation was notified.

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

exports.escalationDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // PRODUCTION
    // var websiteLink = "https://wrudispatch.azurewebsites.net";
    // DEVELOPMENT
    var websiteLink = "https://wrudispatch-dev.azurewebsites.net";

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                "coket1":{ pathName: "CokeT1" },
                "wilcon":{ pathName: "Wilcon", options: { overCICO: "startAt-startOfShift"  } },
            },
            process = function(clientName,pathName){
                const db = client.db(`wd-${clientName}`),
                      notificationsCollection = db.collection('notifications'),
                      dispatchCollection = db.collection('dispatch'),
                      usersCollection = db.collection('users'),
                      regionsCollection = db.collection('regions'),
                      clustersCollection = db.collection('clusters'),
                      geofencesCollection = db.collection('geofences'),
                      sortObject = o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {});
      
                regionsCollection.find({}).toArray().then(rDocs => {
                    clustersCollection.find({}).toArray().then(cDocs => {
                        geofencesCollection.find({}).toArray().then(gDocs => {
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
                                { 
                                    $lookup: {
                                        from: 'vehicles',
                                        localField: 'vehicle_id',
                                        foreignField: '_id',
                                        as: 'vehicle',
                                    }
                                },
                                { $unwind: "$vehicle" }, // do not preserveNull. vehicle is required
                                { $unwind: "$route" }, // do not preserveNull. Route is required
                            ]).toArray().then(docs => {
                                var _ids = {
                                        1: [],
                                        2: [],
                                        3: []
                                    },
                                    hasDelay = {},
                                    assigned = {},
                                    emailDetails = [],
                                    usernames = [],
                                    notificationList = [],
                                    sites = {},
                                    dSites = {},
                                    siteTable = {1:{},2:{},3:{}},
                                    historyUpdate = {},
                                    getDateTime = function(doc,status,type="first"){
                                        var events_captured = sortObject(doc.events_captured||{});
                                        var timestamp;
                                        Object.keys(events_captured).forEach(key => {
                                            if(events_captured[key] == status){
                                                if(type == "first" && !timestamp){
                                                    timestamp = Number(key);
                                                }
                                                if(type == "last"){
                                                    timestamp = Number(key);
                                                }
                                            }
                                        });
                                        return timestamp;
                                    };
                                
                                if(docs.length > 0){
                                    for(var i = 0; i < docs.length; i++){
                                        var doc = docs[i];
                                        
                                        doc.vehicle = doc.vehicle || {}; // because of $unwind
                                        doc.route = doc.route || {}; // because of $unwind
                                        
                                        doc.oGeofence = gDocs.find(x => (x._id||"").toString() == (doc.origin_id||"").toString()) || {};
                                        doc.dGeofence = gDocs.find(x => (x._id||"").toString() == (doc.destination[0].location_id||"").toString()) || {};
                                        
                                        doc.oCluster = cDocs.find(x => (x._id||"").toString() == (doc.oGeofence.cluster_id||"").toString()) || {};
                                        doc.dCluster = cDocs.find(x => (x._id||"").toString() == (doc.dGeofence.cluster_id||"").toString()) || {};
                                        
                                        doc.oRegion = rDocs.find(x => (x._id||"").toString() == (doc.oGeofence.region_id||"").toString()) || {};
                                        doc.dRegion = rDocs.find(x => (x._id||"").toString() == (doc.dGeofence.region_id||"").toString()) || {};
                    
                                        // origin sites
                                        if(sites[doc.oGeofence.short_name]){
                                            sites[doc.oGeofence.short_name].push(doc);
                                        } else {
                                            sites[doc.oGeofence.short_name] = [doc];
                                        }
                                        // destination sites
                                        if(dSites[doc.dGeofence.short_name]){
                                            dSites[doc.dGeofence.short_name].push(doc);
                                        } else {
                                            dSites[doc.dGeofence.short_name] = [doc];
                                        }
                                    }
                    
                                    Object.keys(dSites).forEach(key => {
                                        dSites[key].forEach(doc => {
                                            if(doc.status == "in_transit"){
                                                // OVER TRANSIT
                                            
                                                var inTransitTimestamp = getDateTime(doc,"in_transit","last");
                                                if(inTransitTimestamp){
                                                    var transit_time = getTimestamp() - getTimestamp(inTransitTimestamp),
                                                        actual_time_lapse = decimalHours(transit_time),
                                                        delay = roundOff(actual_time_lapse-doc.route.transit_time);
                                                    console.log("I",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,doc.route.transit_time,actual_time_lapse,delay,(delay > 0 && delay <= 1 && doc.escalation1 != true),(delay > 1 && delay <= 3 && doc.escalation2 != true),(delay > 3 && doc.escalation3 != true));
                    
                                                    if(delay > 0 && delay <= 1 && doc.escalation1 != true){
                                                        _ids[1].push(doc._id);
                                                        hasDelay.escalation01 = true;
            
                                                        setPersonInCharge("escalation1","ot",doc);
            
                                                        var obj = {
                                                            _id: doc._id,
                                                            delay_text: "Over Transit",
                                                            delay_type: "ot",
                                                            site:key,
                                                            cluster: doc.dCluster.cluster,
                                                            vehicle: doc.vehicle.name,
                                                            trailer: doc.vehicle.Trailer || "-",
                                                            target_time: doc.route.transit_time,
                                                            actual_time_lapse
                                                        };

                                                        var _key_ = key;
                                                        // send Over Transit notif to vehicle's base plant people. (COKE)
                                                        if(clientName == "coket1"){
                                                            _key_ =  doc.oGeofence.short_name;
                                                            // _key_ =  doc.vehicle.base_plant || doc.oGeofence.short_name;
                                                        }
                                                        siteTable[1][_key_] = siteTable[1][_key_] || {};
                                                        (siteTable[1][_key_].ot)?siteTable[1][_key_].ot.push(obj):siteTable[1][_key_].ot = [obj];
                                                    } else if(delay > 1 && delay <= 3 && doc.escalation2 != true){
                                                        _ids[2].push(doc._id);
                                                        hasDelay.escalation02 = true;
            
                                                        setPersonInCharge("escalation2","ot",doc);
            
                                                        // escalation 2 should show escalation 1 remarks
                                                        var remarks = doc.esc1_remarks || {};
                                                        var remarksHTML = [];
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "ot"){
                                                                remarksHTML.push(`• ${value.remarks}`);
                                                            }
                                                        });

                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Over Transit",
                                                                delay_type: "ot",
                                                                target_time: doc.route.transit_time,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.dCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML.join("<br>")
                                                            };

                                                        var _key_ = key;
                                                        // send Over Transit notif to vehicle's base plant people. (COKE)
                                                        if(clientName == "coket1"){
                                                            _key_ =  doc.oGeofence.short_name;
                                                            // _key_ =  doc.vehicle.base_plant || doc.oGeofence.short_name;
                                                        }
                                                        siteTable[2][_key_] = siteTable[2][_key_] || {};
                                                        (siteTable[2][_key_].ot)?siteTable[2][_key_].ot.push(obj):siteTable[2][_key_].ot = [obj];
                                                    } else if(delay > 3 && doc.escalation3 != true){
                                                        _ids[3].push(doc._id);
                                                        hasDelay.escalation03 = true;
            
                                                        setPersonInCharge("escalation3","ot",doc);
            
                                                        var remarksHTML = "";
                                                        // escalation 3 should show escalation 1&2 remarks
                                                        var esc1HTML = [];
                                                        var remarks = doc.esc1_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "ot"){
                                                                esc1HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        var esc2HTML = [];
                                                        var remarks = doc.esc2_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "ot"){
                                                                esc2HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        if(esc1HTML.length > 0){
                                                            remarksHTML += `Escalation 1:<br>${esc1HTML.join("<br>")}`;
                                                        }
                                                        if(esc1HTML.length > 0 && esc2HTML.length > 0){
                                                            remarksHTML += `<br><br>`;
                                                        }
                                                        if(esc2HTML.length > 0){
                                                            remarksHTML += `Escalation 2:<br>${esc2HTML.join("<br>")}`;
                                                        }
                                                        
                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Over Transit",
                                                                delay_type: "ot",
                                                                target_time: doc.route.transit_time,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.dCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML
                                                            };

                                                        var _key_ = key;
                                                        // send Over Transit notif to vehicle's base plant people. (COKE)
                                                        if(clientName == "coket1"){
                                                            _key_ =  doc.oGeofence.short_name;
                                                            // _key_ =  doc.vehicle.base_plant || doc.oGeofence.short_name;
                                                        }
                                                        siteTable[3][_key_] = siteTable[3][_key_] || {};
                                                        (siteTable[3][_key_].ot)?siteTable[3][_key_].ot.push(obj):siteTable[3][_key_].ot = [obj];
                                                    }
                                                }
                                            }
                                        });
                                    });
                                    Object.keys(sites).forEach(key => {
                                        sites[key].forEach(doc => {
                                            var delayIdentified = false; // to prevent duplicate of notification in queueingAtOrigin
                                           
                                            if(doc.status == "queueingAtOrigin"){
                                                // LONG QUEUEING
                                                var queueingTimestamp = getDateTime(doc,"queueingAtOrigin","last");
                                                if(queueingTimestamp){
                                                    var queueingDuration = getTimestamp() - getTimestamp(queueingTimestamp),
                                                        actual_time_lapse = decimalHours(queueingDuration),
                                                        target_time = 0.5;
                                                    console.log("Q",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,queueingDuration,actual_time_lapse,(actual_time_lapse > 0.5 && actual_time_lapse <= 1 && doc.escalation1 != true),(actual_time_lapse > 1 && actual_time_lapse <= 1.5 && doc.escalation2 != true),(actual_time_lapse > 1.5 && doc.escalation3 != true));
                    
                                                    if(actual_time_lapse > 0.5 && actual_time_lapse <= 1 && doc.escalation1 != true){
                                                        _ids[1].push(doc._id);
                                                        hasDelay.escalation01 = true;
            
                                                        setPersonInCharge("escalation1","lq",doc);
            
                                                        var obj = {
                                                            _id: doc._id,
                                                            delay_text: "Long Queueing",
                                                            delay_type: "lq",
                                                            target_time,
                                                            site:key,
                                                            cluster: doc.oCluster.cluster,
                                                            vehicle: doc.vehicle.name,
                                                            trailer: doc.vehicle.Trailer || "-",
                                                            actual_time_lapse
                                                        };
                                                    siteTable[1][key] = siteTable[1][key] || {};
                                                    (siteTable[1][key].lq)?siteTable[1][key].lq.push(obj):siteTable[1][key].lq = [obj];
                                                        delayIdentified = true;
                                                    } else if(actual_time_lapse > 1 && actual_time_lapse <= 1.5 && doc.escalation2 != true){
                                                        _ids[2].push(doc._id);
                                                        hasDelay.escalation02 = true;
            
                                                        setPersonInCharge("escalation2","lq",doc);

                                                        // escalation 2 should show escalation 1 remarks
                                                        var remarks = doc.esc1_remarks || {};
                                                        var remarksHTML = [];
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "lq"){
                                                                remarksHTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
            
                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Long Queueing",
                                                                delay_type: "lq",
                                                                target_time,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.oCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML.join("<br>")
                                                            };
                                                        siteTable[2][key] = siteTable[2][key] || {};
                                                        (siteTable[2][key].lq)?siteTable[2][key].lq.push(obj):siteTable[2][key].lq = [obj];
                                                        delayIdentified = true;
                                                    } else if(actual_time_lapse > 1.5 && doc.escalation3 != true){
                                                        _ids[3].push(doc._id);
                                                        hasDelay.escalation03 = true;
            
                                                        setPersonInCharge("escalation3","lq",doc);

                                                        var remarksHTML = "";
                                                        // escalation 3 should show escalation 1&2 remarks
                                                        var esc1HTML = [];
                                                        var remarks = doc.esc1_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "lq"){
                                                                esc1HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        var esc2HTML = [];
                                                        var remarks = doc.esc2_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "lq"){
                                                                esc2HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        if(esc1HTML.length > 0){
                                                            remarksHTML += `Escalation 1:<br>${esc1HTML.join("<br>")}`;
                                                        }
                                                        if(esc1HTML.length > 0 && esc2HTML.length > 0){
                                                            remarksHTML += `<br><br>`;
                                                        }
                                                        if(esc2HTML.length > 0){
                                                            remarksHTML += `Escalation 2:<br>${esc2HTML.join("<br>")}`;
                                                        }
            
                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Long Queueing",
                                                                delay_type: "lq",
                                                                target_time,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.oCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML
                                                            };
                                                        siteTable[3][key] = siteTable[3][key] || {};
                                                        (siteTable[3][key].lq)?siteTable[3][key].lq.push(obj):siteTable[3][key].lq = [obj];
                                                        delayIdentified = true;
                                                    }
                                                }
                                            }
                                            if(["queueingAtOrigin","processingAtOrigin","idlingAtOrigin"].includes(doc.status) && !delayIdentified){
                                                // OVER CICO

                                                var lastTimestamp = getDateTime(doc,doc.status,"last");
                                                var cico_time = getTimestamp() - lastTimestamp;

                                                // console.log("CLIENTS[clientName]",CLIENTS[clientName]);
                                                if(CLIENTS[clientName] && CLIENTS[clientName].options && CLIENTS[clientName].options.overCICO == "startAt-startOfShift"){
                                                    var scheduled_date = moment(doc.scheduled_date).format("MMM DD, YYYY");
                                                    var shift_schedule = (doc.shift_schedule||"").split(" - ")[0];
                                                    var startOfShift = new Date(scheduled_date + ", " + shift_schedule).getTime();

                                                    cico_time = (startOfShift || getTimestamp()) - lastTimestamp;

                                                    if(!startOfShift){
                                                        console.log("NO-SHIFT:",doc._id);
                                                    }
                                                }
                                        
                                                if(lastTimestamp && cico_time){
                                                    var actual_time_lapse = decimalHours(cico_time),
                                                        delay = roundOff(actual_time_lapse-doc.oGeofence.cico);
                                                    console.log("P",doc._id,doc.escalation1,doc.escalation2,doc.escalation3,doc.oGeofence.cico,actual_time_lapse,delay,(delay > 0 && delay <= 1 && doc.escalation1 != true),(delay > 1 && delay <= 3 && doc.escalation2 != true),(delay > 3 && doc.escalation3 != true));
                    
                                                    if(delay > 0 && delay <= 1 && doc.escalation1 != true){
                                                        _ids[1].push(doc._id);
                                                        hasDelay.escalation01 = true;
            
                                                        setPersonInCharge("escalation1","oc",doc);
            
                                                        var obj = {
                                                            _id: doc._id,
                                                            delay_text: "Over CICO",
                                                            delay_type: "oc",
                                                            site:key,
                                                            cluster: doc.oCluster.cluster,
                                                            vehicle: doc.vehicle.name,
                                                            trailer: doc.vehicle.Trailer || "-",
                                                            target_time: doc.oGeofence.cico,
                                                            actual_time_lapse
                                                        };
                                                        siteTable[1][key] = siteTable[1][key] || {};
                                                        (siteTable[1][key].oc)?siteTable[1][key].oc.push(obj):siteTable[1][key].oc = [obj];
                                                    } else if(delay > 1 && delay <= 3 && doc.escalation2 != true){
                                                        _ids[2].push(doc._id);
                                                        hasDelay.escalation02 = true;
            
                                                        setPersonInCharge("escalation2","oc",doc);
            
                                                        // escalation 2 should show escalation 1 remarks
                                                        var remarks = doc.esc1_remarks || {};
                                                        var remarksHTML = [];
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "oc"){
                                                                remarksHTML.push(`• ${value.remarks}`);
                                                            }
                                                        });

                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Over CICO",
                                                                delay_type: "oc",
                                                                target_time: doc.oGeofence.cico,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.oCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML.join("<br>")
                                                            };
                                                        siteTable[2][key] = siteTable[2][key] || {};
                                                        (siteTable[2][key].oc)?siteTable[2][key].oc.push(obj):siteTable[2][key].oc = [obj];
                                                    } else if(delay > 3 && doc.escalation3 != true){
                                                        _ids[3].push(doc._id);
                                                        hasDelay.escalation03 = true;
                                                        
                                                        setPersonInCharge("escalation3","oc",doc);
            
                                                        var remarksHTML = "";
                                                        // escalation 3 should show escalation 1&2 remarks
                                                        var esc1HTML = [];
                                                        var remarks = doc.esc1_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "oc"){
                                                                esc1HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        var esc2HTML = [];
                                                        var remarks = doc.esc2_remarks || {};
                                                        Object.keys(remarks).forEach(key => {
                                                            var value = remarks[key];
                                                            if(value.type == "oc"){
                                                                esc2HTML.push(`• ${value.remarks}`);
                                                            }
                                                        });
                                                        if(esc1HTML.length > 0){
                                                            remarksHTML += `Escalation 1:<br>${esc1HTML.join("<br>")}`;
                                                        }
                                                        if(esc1HTML.length > 0 && esc2HTML.length > 0){
                                                            remarksHTML += `<br><br>`;
                                                        }
                                                        if(esc2HTML.length > 0){
                                                            remarksHTML += `Escalation 2:<br>${esc2HTML.join("<br>")}`;
                                                        }

                                                        var obj = {
                                                                _id: doc._id,
                                                                delay_text: "Over CICO",
                                                                delay_type: "oc",
                                                                target_time: doc.oGeofence.cico,
                                                                actual_time_lapse,
                                                                site:key,
                                                                cluster: doc.oCluster.cluster,
                                                                vehicle: doc.vehicle.name,
                                                                trailer: doc.vehicle.Trailer || "-",
                                                                remarks: remarksHTML
                                                            };
                                                        siteTable[3][key] = siteTable[3][key] || {};
                                                        (siteTable[3][key].oc)?siteTable[3][key].oc.push(obj):siteTable[3][key].oc = [obj];
                                                    }
                                                }
                                            }
                                        });
                                    });
                                    if(Object.keys(hasDelay).length > 0){
                                        getAssignedPerson().then(_docs => {
                                            _docs = _docs || [];
                                            if(hasDelay.escalation01 === true){
                                                Object.keys(siteTable[1]).forEach(sKey => {
            
                                                    assigned[sKey] = assigned[sKey] || {};
                                                    assigned[sKey].escalation1 = assigned[sKey].escalation1 || {};
            
                                                    Object.keys(siteTable[1][sKey]).forEach(sType => {
            
                                                        assigned[sKey].escalation1[sType] = assigned[sKey].escalation1[sType] || [];
            
                                                        if(assigned[sKey].escalation1[sType].length > 0){
                                                            
                                                            assigned[sKey].escalation1[sType].forEach(username => {
                                                                var user = _docs.find(x => x._id == username);
                                                                if(user && user.email){
                                                                    emailDetails.push({
                                                                        escalation: 1,
                                                                        to: user.email,
                                                                        subject: `Escalation 01 at ${sKey}`,
                                                                        content: escalation01(user,siteTable[1][sKey][sType])
                                                                    });
                                                                } else {
                                                                    escalation01({},siteTable[1][sKey][sType]);
                                                                }
                                                            });
                                                        } else {
                                                            escalation01({},siteTable[1][sKey][sType]);
                                                        }
                                                    });
                                                });
                                            }
                                            if(hasDelay.escalation02 === true){
                                                Object.keys(siteTable[2]).forEach(sKey => {
            
                                                    assigned[sKey] = assigned[sKey] || {};
                                                    assigned[sKey].escalation2 = assigned[sKey].escalation2 || {};
            
                                                    Object.keys(siteTable[2][sKey]).forEach(sType => {
            
                                                        assigned[sKey].escalation2[sType] = assigned[sKey].escalation2[sType] || [];
            
                                                        if(assigned[sKey].escalation2[sType].length > 0){
                                                            
                                                            assigned[sKey].escalation2[sType].forEach(username => {
                                                                var user = _docs.find(x => x._id == username);
                                                                if(user && user.email){
                                                                    emailDetails.push({
                                                                        escalation: 2,
                                                                        to: user.email,
                                                                        subject: `Escalation 02 at ${sKey}`,
                                                                        content: escalation02_03(user,siteTable[2][sKey][sType],2)
                                                                    });
                                                                } else {
                                                                    escalation02_03({},siteTable[2][sKey][sType],2);
                                                                }
                                                            });
                                                        } else {
                                                            escalation02_03({},siteTable[2][sKey][sType],2);
                                                        }
                                                    });
                                                });
                                            }
                                            if(hasDelay.escalation03 === true){
                                                Object.keys(siteTable[3]).forEach(sKey => {
            
                                                    assigned[sKey] = assigned[sKey] || {};
                                                    assigned[sKey].escalation3 = assigned[sKey].escalation3 || {};
            
                                                    Object.keys(siteTable[3][sKey]).forEach(sType => {
            
                                                        assigned[sKey].escalation3[sType] = assigned[sKey].escalation3[sType] || [];
            
                                                        if(assigned[sKey].escalation3[sType].length > 0){
                                                            
                                                            assigned[sKey].escalation3[sType].forEach(username => {
                                                                var user = _docs.find(x => x._id == username);
                                                                if(user && user.email){
                                                                    emailDetails.push({
                                                                        escalation: 3,
                                                                        to: user.email,
                                                                        subject: `Escalation 03 at ${sKey}`,
                                                                        content: escalation02_03(user,siteTable[3][sKey][sType],3)
                                                                    });
                                                                } else {
                                                                    escalation02_03({},siteTable[3][sKey][sType],3);
                                                                }
                                                            });
                                                        } else {
                                                            escalation02_03({},siteTable[3][sKey][sType],3);
                                                        }
                                                    });
                                                });
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
                                function setPersonInCharge(escalation,type,doc){
                                    var region = doc.oRegion;
                                    var cluster = doc.oCluster;
                                    var geofence = doc.oGeofence

                                    if(type == "ot"){
                                        region = doc.dRegion;
                                        cluster = doc.dCluster;
                                        geofence = doc.dGeofence;
                                        
                                        if(clientName == "coket1"){
                                            var basePlantGeofence = gDocs.find(x => x.short_name == doc.vehicle.base_plant);
                                            if(basePlantGeofence){
                                                geofence = basePlantGeofence;
                                                region = rDocs.find(x => (x._id||"").toString() == (geofence.region_id||"").toString()) || {};
                                                cluster = cDocs.find(x => (x._id||"").toString() == (geofence.cluster_id||"").toString()) || {};
                                            }
                                        }
                                    }
                                    // should be after all conditions
                                    var short_name = geofence.short_name;
            
                                    if(!assigned[short_name]){
                                        var rPIC = region.person_in_charge || {};
                                        var cPIC = cluster.person_in_charge || {};
                                        var gPIC = geofence.person_in_charge || {};
            
                                        var person_in_charge = {};
                
                                        function populateSelect2(_escalation_,_type_){
                                            rPIC[_escalation_] = rPIC[_escalation_] || {};
                                            cPIC[_escalation_] = cPIC[_escalation_] || {};
                                            gPIC[_escalation_] = gPIC[_escalation_] || {};
            
                                            person_in_charge[_escalation_] = person_in_charge[_escalation_] || {};
            
                                            var rPICArr = ((rPIC[_escalation_][_type_] || []).length > 0) ? rPIC[_escalation_][_type_] : null;
                                            var cPICArr = ((cPIC[_escalation_][_type_] || []).length > 0) ? cPIC[_escalation_][_type_] : null;
                                            var gPICArr = ((gPIC[_escalation_][_type_] || []).length > 0) ? gPIC[_escalation_][_type_] : null;
            
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
            
                                    usernames = usernames.concat(assigned[short_name][escalation][type]);
                                }
                                function proceedToUpdate(){
                                    if(Object.keys(_ids).length > 0){
                                        var childPromise = [];
                                        (notificationList.length > 0) ? childPromise.push(notificationsCollection.insertMany(notificationList)) : null;
                                
                                        Object.keys(_ids).forEach(function(key) {
                                            var notif = notificationList.find(x => _ids[key].includes(x.dispatch_id));
                                            
                                            try{
                                                console.log("nofif:",!!notif,"_ids[escalation]",_ids[escalation].length);
                                            } catch(error){
                                                console.log("nofif: - ERROR");
                                            }
                                            if(notificationList && notif){
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
                                        try{
                                            console.log("historyUpdate",Object.keys(historyUpdate).length);
                                        } catch(error){
                                            console.log("historyUpdate - ERROR");
                                        }
                                        Object.keys(historyUpdate).forEach(function(key) {
                                            var _set = {};
                                            _set[`history.${getTimestamp()}`] = key;
                                            
                                            childPromise.push(dispatchCollection.updateMany({"_id": {$in: historyUpdate[key]}}, {   
                                                $set: _set
                                            })); 
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
                                            childPromise.push(transporter.sendMail({
                                                from: '"WRU Dispatch" <noreply@wru.ph>', // sender address
                                                to: val.to || defaultUser.email, // list of receivers
                                                subject: val.subject, // Subject line
                                                text: val.content,
                                                html: val.content,
                                            }));
                                        });
                                        if(childPromise.length > 0){
                                            Promise.all(childPromise).then(data => {
                                                console.log("SEND DATA",JSON.stringify(data));
                                                proceedToUpdate();
                                            }).catch(error => {
                                                console.log("Failed to send email.");
                                                proceedToUpdate();
                                            });
                                        } else {
                                            proceedToUpdate();
                                        }
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
                                function escalation01(user={},tbl){
                                    var date = moment(new Date()).format("MMMM DD, YYYY, h:mm A"),
                                        link = "",
                                        linkData = { _ids: [], clientId: clientName, escalation: 1, username: user._id || "-", name: user.name || "" },
                                        detailsHTML = "",
                                        summary = {},
                                        summaryHTML = "",
                                        site = "-",
                                        escalation = 1,
                                        oddOrEven = function(i){
                                            return ( i & 1 ) ? "odd" : "even";
                                        };
                                    tbl.forEach((val,i) => {
                                        site = val.site;
                                        linkData._ids.push({
                                            _id: val._id,
                                            delay: val.delay_text,
                                            type: val.delay_type
                                        });
                                        notificationList.push({
                                            type: "delay",
                                            escalation,
                                            delay_type: val.delay_text,
                                            timelapse: roundOff(val.actual_time_lapse),
                                            site,
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
                                        
                                        var index = `${val.delay_text} - Escalation ${escalation}`;
                                        if(historyUpdate[index]) historyUpdate[index].push(val._id);
                                        else historyUpdate[index] = [val._id];
            
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
                                    link = `<br><div>Please click this <a href="${websiteLink}/remarks?data=${encodedString}" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
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
                                                    <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${moment().format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                                </body>
                                            </html>`;
                                }
                                function escalation02_03(user={},tbl,escalation){
                                    try{
                                        console.log("Inside escalation02_03",tbl.length);
                                    } catch(error){
                                        console.log("Inside escalation02_03 - ERROR");
                                    }
                                    var date = moment(new Date()).format("MMMM DD, YYYY, h:mm A"),
                                        detailsHTML = "",
                                        summary = {},
                                        summaryHTML = "",
                                        link = "",
                                        linkData = { _ids: [], clientId: clientName, escalation, username: user._id || "-", name: user.name || "" },
                                        site = null,
                                        cluster = null,
                                        oddOrEven = function(i){
                                            return ( i & 1 ) ? "odd" : "even";
                                        };
                                    tbl.forEach((val,i) => {
                                        if(site == null){
                                            site = val.site;
                                            cluster = val.cluster || "-";
                                        }
                                        linkData._ids.push({
                                            _id: val._id,
                                            delay: val.delay_text,
                                            type: val.delay_type
                                        });
                                        notificationList.push({
                                            type: "delay",
                                            escalation,
                                            delay_type: val.delay_text,
                                            timelapse: roundOff(val.actual_time_lapse),
                                            site,
                                            timestamp: moment(new Date()).toISOString(),
                                            dispatch_id: val._id,
                                            // vehicle: val.vehicle,
                                            username: user._id || "-",
                                            read: false
                                        });
                                        var remarks = (val.remarks)?val.remarks:`<span class="no-remarks">No remarks received</span>`;
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
            
                                        var index = `${val.delay_text} - Escalation ${escalation}`;
                                        if(historyUpdate[index]) historyUpdate[index].push(val._id);
                                        else historyUpdate[index] = [val._id];
            
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
                                                            <td>${cluster||"-"}</td>
                                                            <td>${val.units}</td>
                                                            <td>${hoursMinutes(val.ave_target_time)}</td>
                                                            <td>${hoursMinutes(val.ave_time_lapse)}</td>
                                                        </tr>`;
                                    });
                                    var baseString = JSON.stringify(linkData),
                                        encodedString = Buffer.from(baseString, 'binary').toString('base64');
                                    link = `<br><div>Please click this <a href="${websiteLink}/remarks?data=${encodedString}" target="_blank">link</a> to proceed to your account for inputting of remarks.</div>`;
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
                                                    <div style="font-size: 11px;margin-bottom: 20px;color: #a0aeba;">© 2020 - ${moment().format("YYYY")} <a href="https://www.wru.ph" target="_blank" style="color: #71bd46;text-decoration: none;">WRU Corporation</a>. All Rights Reserved</div>
                                                </body>
                                            </html>`;
                                }
                                /*************** END FUNCTIONS ***************/
                            }).catch(error => {
                                console.log(error);
                                client.close();
                                res.status(500).send('Error dispatch: ');
                            }); 
                        }).catch(error => {
                            console.log(error);
                            client.close();
                            res.status(500).send('Error clusters: ');
                        }); 
                    }).catch(error => {
                        console.log(error);
                        client.close();
                        res.status(500).send('Error clusters: ');
                    }); 
                }).catch(error => {
                    console.log(error);
                    client.close();
                    res.status(500).send('Error regions: ');
                }); 
                
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                console.log("CLIENTS",CLIENTS);
                if(done === true){
                    client.close();
                    res.status(200).send("OK");
                }
            };

        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            var pathName = CLIENTS[key].pathName;
            // CLIENTS[key] = null;
            process(key,pathName);
        });
        /************** END OF PROCESS **************/
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};