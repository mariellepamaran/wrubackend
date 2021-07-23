const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;
const moment = require('moment-timezone');

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.scheduledDispatchDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    
    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                  "coket1":null,
                  "wilcon":null,
            },
            date = moment().valueOf(),
            process = function(clientName){
                const db = client.db(`wd-${clientName}`),
                    dispatchCollection = db.collection('dispatch'),
                    geofencesCollection = db.collection('geofences'),
                    vehiclesHistoryCollection = db.collection('vehicles_history');

                var OBJECT = {
                    sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                    getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
                };

                dispatchCollection.find({ status: "scheduled" }).toArray().then(docs => {
                    var vehicleIds = [];
                    var originIds = [];
                    var entries = [];
                    var childPromise = [];

                    function withinSchedule(date,minMaxTime,allowAllGreaterMinTime){
                        date = moment(new Date(date)).format("MMM DD, YYYY");
                
                        var _withinSchedule_ = false;
                        var shiftArr = (minMaxTime||"").split(" - ");
                        var shiftMinTime = shiftArr[0];
                        var shiftMaxTime = shiftArr[1];
                        var beginningTime = moment(shiftMinTime, 'h:mm A');
                        var endTime = moment(shiftMaxTime, 'h:mm A');
                        var dateTemp = (!beginningTime.isBefore(endTime)) ? moment(new Date(date)).add(1,"day").format("MMM DD, YYYY") : date;
                        
                        // activate entry XX minutes before scheduled time
                        var minutes = 60; // 60 minutes
                        var minTimeTZ = moment.tz(`${date}, ${shiftMinTime}`, "MMM DD, YYYY, h:mm A",  "Asia/Manila").subtract(minutes,"minutes");
                        var minTimeISO = minTimeTZ.toDate();
                        var minTime = moment(minTimeISO).valueOf();

                        var maxTimeTZ = moment.tz(`${dateTemp}, ${shiftMaxTime}`, "MMM DD, YYYY, h:mm A",  "Asia/Manila");
                        var maxTimeISO = maxTimeTZ.toDate();
                        var maxTime = moment(maxTimeISO).valueOf();

                        var currentTime = moment().valueOf();
                        
                        if((currentTime >= minTime && currentTime <= maxTime) || (allowAllGreaterMinTime && currentTime < minTime)){
                            _withinSchedule_ = true;
                        }
                        return _withinSchedule_;
                    }

                    docs.forEach(val => {
                        if(withinSchedule(val.scheduled_date,val.shift_schedule)){
                            console.log("In schedule",val.scheduled_date,val.shift_schedule);
                            vehicleIds.push(Number(val.vehicle_id));
                            originIds.push(ObjectId(val.origin_id));
                            entries.push({
                                _id: val._id,
                                vehicle_id: Number(val.vehicle_id),
                                origin_id: val.origin_id
                            });
                        }
                    });
                    console.log("entries",entries);
                    if(entries.length > 0){
                        vehiclesHistoryCollection.find({ _id: { $in: vehicleIds } }).toArray().then(vHDocs => {
                            geofencesCollection.find({ _id: { $in: originIds } }).toArray().then(gDocs => {
                                entries.forEach(eVal => {
                                    var __events_captured = {};
                                    var getIndexOf = function(text,arr,op){
                                        var cond = null;
                                        arr.forEach(val => {
                                            if(op == "or" && !cond){
                                                cond = (text.indexOf(val) > -1);
                                            }
                                            if(op == "and" && (cond == null || cond == true)){
                                                cond = (text.indexOf(val) > -1);
                                            }
                                        });
                                        return cond;
                                    },
                                    getStat_Time = function(oEvents){
                                        var gStat = "assigned",
                                            gCond = false;
                                            
                                        var tempDateTime = new Date().getTime();
                                        for(var i = oEvents.length-1; i >= 0; i--){
                                            var val = oEvents[i],
                                                eventDate = new Date(val.timestamp).getTime(),
                                                hourDiff = Math.abs(tempDateTime - eventDate) / 36e5;
                                                
                                            // idling
                                            if(getIndexOf(val.RULE_NAME,["Inside","Idle"],"and") && !__events_captured[eventDate]){
                                                gCond = true;
                                                __events_captured[eventDate] = "idlingAtOrigin";
                                            }
                                            // processing
                                            if(getIndexOf(val.RULE_NAME,["Inside","Processing"],"and") && !__events_captured[eventDate]){
                                                gCond = true;
                                                __events_captured[eventDate] = "processingAtOrigin";
                                            }
                                            // queueing
                                            if(getIndexOf(val.RULE_NAME,["Inside","Queueing"],"and") && !__events_captured[eventDate]){
                                                gCond = true;
                                                __events_captured[eventDate] = "queueingAtOrigin";
                                            }

                                            // temp Status
                                            if(!__events_captured[eventDate]){
                                                __events_captured[eventDate] = "tempStatus";
                                            }
                                        }

                                        // sort events_capture
                                        var sortedEvents = OBJECT.sortByKey(__events_captured);
                                        var i = 0;
                                        var lastTimestamp;
                                        Object.keys(sortedEvents).forEach(key => {
                                            if(i == 0){
                                                i++;
                                                // if first timestamp is not in transit
                                                if(sortedEvents[key] != "in_transit"){
                                                    // change value to entered_origin
                                                    sortedEvents[key] = "entered_origin";
                                                }
                                            }
                                        });

                                        // loop to delete tempStatus
                                        Object.keys(sortedEvents).forEach(key => {
                                            if(sortedEvents[key] == "tempStatus"){
                                                delete sortedEvents[key];
                                            }
                                        });

                                        // had to loop again because tempStatus is deleted. Ends up sortedEvents[lastTimestamp] to be undefined
                                        Object.keys(sortedEvents).forEach(key => { lastTimestamp = key; });
                                        
                                        __events_captured = sortedEvents;


                                        // status will be last timestamp's value
                                        gStat = sortedEvents[lastTimestamp] || "assigned";
                                        console.log("sortedEvents",gStat,sortedEvents);
                                        if(gStat == "entered_origin"){
                                            // gStat = (clientName == "wilcon") ? "processingAtOrigin" : "assigned";
                                            gStat = "assigned";
                                        }

                                        return gStat;
                                    };

                                    var set = { status:"assigned" };

                                    var origin = gDocs.find(x => x._id.toString() == eVal.origin_id.toString());
                                    var vehicleHistory = vHDocs.find(x => x._id == eVal.vehicle_id);
                                    var loc = vehicleHistory.location || [];
                                    var lastLoc = loc[loc.length-1];
                                    
                                    if(lastLoc.short_name == origin.short_name){
                                        var status = getStat_Time(lastLoc.events);
                                        set[`events_captured`] = __events_captured; // must be after getStat_Time()
                                        set[`history.${date}`] = `Scheduled Dispatch - Status updated to <status>${status}</status>.`;
                                        set.status = status;
                                    } else {
                                        set[`history.${date}`] = `Scheduled Dispatch - Status updated to <status>assigned</status>.`;
                                    }
                                    childPromise.push(dispatchCollection.updateOne({_id: eVal._id },{$set:set}));
                                });
                                Promise.all(childPromise).then(() => {
                                    areClientsDone(clientName);
                                }).catch(error => {
                                    console.log("Error Updating"+JSON.stringify(error),error.toString());
                                    res.status(500).send('Error Updating: ' + JSON.stringify(error));
                                });
                            });
                        });
                    } else {
                        areClientsDone(clientName);
                    }
                }).catch(error => {
                    console.log("Error Updating"+JSON.stringify(error),error.toString());
                    res.status(500).send('Error Updating: ' + JSON.stringify(error));
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
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        console.log("Error"+JSON.stringify(error),error.toString());
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};