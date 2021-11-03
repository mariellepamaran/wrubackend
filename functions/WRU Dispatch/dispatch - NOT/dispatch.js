const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const request = require('request');

const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.dispatch = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/"),
            clientName = params_value[0],
            urlTag = params_value[1],
            secretkey = params_value[2],
            CLIENTS = {
                "coket1":"ir3kpfwo4hpJu8XruRmwVDnwpZY35DWtNVsQ",
                "wilcon":"c8LQni7Ql5z1iL678YW3DC5cIUVTUM9g5P37",
            };
        body = body.toString();

        console.log("Method",method);
        console.log("Body",JSON.stringify(body));
        console.log("Query",query);
        console.log("Params",params);

        if(clientName && urlTag == "import" && secretkey && CLIENTS[clientName] == secretkey){
            const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
                  db = client.db(`wd-${clientName}`),
                  dispatchCollection = db.collection('dispatch'),
                  vehiclesCollection = db.collection('vehicles'),
                  vehiclesHistoryCollection = db.collection('vehicles_history'), // ADD THIS. TINATAMAD AKO NGAYON AHHAHAHA 06/01/2021 5:54 PM
                  routesCollection = db.collection('routes'),
                  ggsURL = process.env[`${clientName}_ggsurl`],
                  appId = process.env[`${clientName}_appid`],
                  username = process.env[`${clientName}_username`],
                  password = process.env[`${clientName}_password`];
            var OBJECT = {
                sortByKey: o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {}),
                getKeyByValue: (o,v) => Object.keys(o).find(key => o[key] === v),
            };

            if(method == "POST"){
                var _error_ = null,
                    addError = function(data){
                        _error_ = _error_ || [];
                        _error_.push(data);
                    },
                    dupsSN = function(arr,message){
                        if(arr.length > 0){
                            arr.forEach(_id => {
                                addError({
                                    "Shipment Number": _id,
                                    "Message": message
                                });
                            });
                        }
                    },
                    HH_MM = function(ms,dh,def){
                        def = def==null?"-":def;
                        var hour = "",
                            minute = "";
                        if(ms && ms >=0 || dh != null){
                            (ms && ms >=0) ? dh = (ms/3600)/1000 : null; // milliseconds to decimal hours
                            (dh != null) ? dh = Number(dh) : null;
                
                            dh = dh.toFixed(2);
            
                            hour = dh.toString().split(".")[0]; // convert decimal hour to HH:MM
                            minute = JSON.stringify(Math.round((dh % 1)*60)).split(".")[0];
                            if(hour.length < 2) hour = '0' + hour;
                            if(minute.length < 2) minute = '0' + minute;
                            def = `${hour}:${minute}`;
                        }
                        return {
                            hour,
                            minute,
                            hour_minute: def,
                        };
                    },
                    version = "F-1.0.4",
                    shipment_number = "",
                    route = "",
                    vehicle_en = "",
                    importData = null,
                    __tempStat = null,
                    __vehicleData = null,
                    __events_captured = {},
                    late_data_entry = null,
                    note = null,
                    __status = "plan",
                    getTextFromHTMLTags = function(regx){
                        var nr = regx.exec(body),
                            str;
                        if(nr){
                            str = nr[1];
                            str = str.replace(/^0+/, ''); // remove leading zeros
                        }
                        return str;
                    },
                    saveData = function(){
                        var history = {original: JSON.stringify(importData)};
                        if(__vehicleData){
                            history.vehicle = JSON.stringify(__vehicleData);
                        }

                        importData.history = history;

                        dispatchCollection.insertOne(importData,(err,result)=>{
                            if(err){
                                console.log("Insert Error",err.toString());
                                client.close();
                                res.status(500).send("Internal Server Error");
                            } else {
                                res.status(200).send({nInserted:1, note, error:_error_});
                            }
                        });
                    };
            
                // parse XML data
                shipment_number = getTextFromHTMLTags(/<TKNUM>(.*?)<\/TKNUM>/g); // Shipment Number
                route = getTextFromHTMLTags(/<ROUTE>(.*?)<\/ROUTE>/g); // Route
                vehicle_en = getTextFromHTMLTags(/<BEV1_RPMOWA>(.*?)<\/BEV1_RPMOWA>/g); // Vehicle (Equipment Number)
            
                dispatchCollection.find({_id: shipment_number}).toArray((err,docs)=>{
                    if(err) {
                        console.log("Get Error",err.toString());
                        res.status(500).send("Internal Server Error");
                    } else {
                        if(docs.length > 0){
                            dupsSN([shipment_number],"Shipment Number already exists in the database.");
                            res.status(200).send({nInserted:0, error:_error_});
                        } else {
                            importData = {
                                _id: shipment_number,
                                route,
                                version,
                                destination: [],
                                posting_date: moment(new Date()).toISOString(),
                                comments: "",
                                username: "_API_"
                            };
                            
                            routesCollection.aggregate([
                                {
                                    $match: {_id: route}
                                },
                                { 
                                    $lookup: {
                                        from: 'geofences',
                                        localField: 'origin_id',
                                        foreignField: '_id',
                                        as: 'origin',
                                    }
                                },
                                { 
                                    $lookup: {
                                        from: 'geofences',
                                        localField: 'destination_id',
                                        foreignField: '_id',
                                        as: 'destination',
                                    }
                                },
                            ]).toArray().then(rDocs=>{
                                var rDoc = rDocs[0] || {origin:[],destination:[]},
                                    origin = rDoc.origin[0] || {},
                                    destination = rDoc.destination[0] || {};
                                console.log("rDoc",rDoc);
    
                                // do not change to rDoc. We need to check if existing or not.
                                if(rDocs[0]){
                                    importData.origin = origin.short_name;
                                    importData.origin_id = rDoc.origin_id;
                                    importData.destination = [{
                                        // location: destination.short_name,
                                        location_id: rDoc.destination_id,
                                        // transit_time: rDoc.transit_time,
                                        // cico: destination.cico,
                                    }];
                                }

                                vehiclesCollection.find({"Equipment Number": vehicle_en}).toArray().then(vDocs => {
                                    var vDoc = vDocs[0];
                                    if(vDoc){
                                        importData.vehicle_id = vDoc._id;
                                    }

                                    if(rDocs[0] && vDoc && importData.destination) {
                                        __status = "assigned";
                                    } else {
                                        __status = "plan";
                                    }
                                    importData.status = __status;
                                    
                                    if(__status != "plan"){
                                        request({
                                            method: 'POST',
                                            url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/tokens`,
                                            headers: {
                                                "Content-Type": "application/json"
                                            },
                                            json: true,
                                            body: {username,password}
                                        }, (error, response1, body1) => {
                                            if (!error && response1.statusCode == 200) {
                                                const token = body1.token;
                                                const childPromise = [];
                        
                                                request({
                                                    url: `https://${ggsURL}/comGpsGate/api/v.1/applications/${appId}/geofences/${origin.geofence_id}/users?FromIndex=0&PageSize=500`,
                                                    headers: {
                                                        'Authorization': token
                                                    }
                                                }, (error, response2, body2) => {
                                                    if (!error && response2.statusCode == 200) {
                                                        console.log("Vehicles:",body2);
                                                        body2 = JSON.parse(body2);
                                                        late_data_entry = true;
                                                        try {
                                                            body2.forEach(val => {
                                                                if(val.id == importData.vehicle_id){
                                                                    late_data_entry = false;
                                                                }
                                                            });
        
                                                            var vehicleAjax = function(le){
                                                                var dgeofenceName = destination.short_name;
                                                                var ogeofenceName = origin.short_name;
                        
                                                                var loc = (vDoc||{}).location || []; // don't name it 'location', it will refresh page (page.location??)
                                                                loc[0] = loc[0] || {};
                                                                loc[1] = loc[1] || {};

                                                                __vehicleData = (vDoc||{}).location;
                        
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
                                                                getStat_Time = function(oEvents,dEvents){
                                                                    var gStat = "assigned",
                                                                        gCond = false;

                                                                    var tempDateTime = new Date().getTime();
                                                                    oEvents.forEach(val => {
                                                                        var eventDate = new Date(val.timestamp).getTime(),
                                                                            hourDiff = Math.abs(tempDateTime - eventDate) / 36e5;
    
                                                                        // entered_origin
                                                                        if(val.RULE_NAME == "Inside Geofence" && val.stage == "start" && Object.keys(__events_captured).length == 0){
                                                                            __events_captured[eventDate] = "entered_origin";
                                                                        }
                                                                        // end origin
                                                                        if(Object.keys(__events_captured).length > 0 && gStat != "in_transit"){
                                                                            console.log("In HERE",Object.keys(__events_captured).length,val.RULE_NAME,hourDiff);
    
                                                                            // queueing
                                                                            // if IG queueing, queueingAtOrigin and hours < 8. if status == in_transit/processingAtOrigin, save event time and not status
                                                                            if(getIndexOf(val.RULE_NAME,["Inside Geofence","Queueing"],"and") && gStat != "queueingAtOrigin"){
                                                                                gStat = "queueingAtOrigin";
                                                                                gCond = true;
                                                                                __events_captured[eventDate] = "queueingAtOrigin";
                                                                            }
                                                                            
                                                                            // processing
                                                                            // if IG processing, processingAtOrigin and hours < 8. if status == in_transit, save event time and not status
                                                                            // if status is queueingAtOrigin and !processingAtOrigin, delete queueuingAtOrigin time 
                                                                            if(getIndexOf(val.RULE_NAME,["Inside Geofence","Processing"],"and") && gStat != "processingAtOrigin"){
                                                                                gStat = "processingAtOrigin";
                                                                                gCond = true;
                                                                                __events_captured[eventDate] = "processingAtOrigin";
                                                                            }
                                                                            
                                                                            // idling
                                                                            // if IG processing, idlingAtOrigin and hours < 8. if status == in_transit, save event time and not status
                                                                            // if status is queueingAtOrigin and !idlingAtOrigin, delete queueuingAtOrigin time 
                                                                            if(getIndexOf(val.RULE_NAME,["Inside","Idle"],"and") && gStat != "idlingAtOrigin"){
                                                                                gStat = "idlingAtOrigin";
                                                                                gCond = true;
                                                                                __events_captured[eventDate] = "idlingAtOrigin";
                                                                            }
    
                                                                            // in transit
                                                                            // if inside geofence - end or outside geofence - start, in_transit and hours < 8 and status != assigned/in_transit but time <= 1minute, update to in_transit.
                                                                            // if status is not assigned, delete other time???
                                                                            if(((val.RULE_NAME == "Inside Geofence" && val.stage == "end") || (val.RULE_NAME == "Outside Geofence" && val.stage == "start")) && gStat != "in_transit" && le == true) {
                                                                                gStat = "in_transit";
                                                                                gCond = true;
                                                                                __events_captured[eventDate] = "in_transit";
                                                                                tempDateTime = new Date(val.timestamp).getTime();
                                                                            }
                                                                        }
                                                                    });

                                                                    // CICO AT ORIGIN
                                                                    if(le == true){
                                                                        var hasInTransitDateTime = (gStat=="in_transit");

                                                                        gStat = "in_transit";
                
                                                                        dEvents.forEach(val => {
                                                                            var eventDate = new Date(val.timestamp).getTime(),
                                                                                hourDiff = Math.abs(tempDateTime - eventDate) / 36e5;
                
                                                                            // in transit (if no datetime)
                                                                            if(val.RULE_NAME == "Inside Geofence" && val.stage == "start" && !hasInTransitDateTime){
                                                                                gCond = true;
                                                                                if(hourDiff < 8){
                                                                                    __events_captured[eventDate] = "in_transit";
                                                                                } else {
                                                                                    __events_captured[new Date().getTime()] = "in_transit";
                                                                                }
                                                                            }
                                                                            // end in transit (if no datetime)
                                                                            
                                                                            // complete
                                                                            if(getIndexOf(["Inside Geofence","Outside Geofence"],"or") && val.stage == "start" && gStat == "in_transit" && hourDiff < 8){
                                                                                gStat = "complete";
                                                                                gCond = true;
                                                                                __events_captured[eventDate] = "complete";
                                                                            }
                                                                            // end complete
                                                                        });
                                                                    }
                        
                                                                    return (gCond) ? gStat : null;
                                                                };
                                                                
                                                                if(le) {
                                                                    for(var i = loc.length-1; i >= 0; i--){
                                                                        if(loc[i].short_name == ogeofenceName){
                                                                            late_data_entry = true;
                                                                            __tempStat = getStat_Time(loc[i].events,[]);
                                                                            note = "Truck selected has left the origin. This shipment will be tagged as LATE_DATA_ENTRY and will automatically be saved as IN TRANSIT.";
                                                                            console.log(note);
                                                                            break;
                                                                        } else {
                                                                            if(loc[i].short_name == dgeofenceName){
                                                                                var prevLoc = loc.slice(0, i),
                                                                                    prevHasOrigin = false;
                                                                                for(var j = prevLoc.length-1; j >= 0; j--){
                                                                                    if(prevLoc[j].short_name == dgeofenceName){
                                                                                        break;
                                                                                    }
                                                                                    if(prevLoc[j].short_name == ogeofenceName){
                                                                                        late_data_entry = true;
                                                                                        __tempStat = getStat_Time(prevLoc[j].events,loc[i].events);
                                                                                        prevHasOrigin = true;
                                                                                        note = "Truck selected has left the origin and is already at destination. This shipment will be tagged as LATE_DATA_ENTRY.";
                                                                                        console.log(note);
                                                                                        break;
                                                                                    }
                                                                                }
                                                                                if(!prevHasOrigin){
                                                                                    late_data_entry = false;
                                                                                    __tempStat = "assigned";
                                                                                    note = "Truck selected is not within the origin and destination. It is assumed that the truck is enroute to origin.";
                                                                                    console.log(note);
                                                                                }
                                                                                break;
                                                                            }
                                                                        }
                                                                    }
                                                                    if(__tempStat == null) {
                                                                        console.log("__tempStat is null");
                                                                        __tempStat = "assigned";
                                                                        late_data_entry = false;
                                                                        note = "Truck selected is not within the origin and destination. It is assumed that the truck is enroute to origin.";
                                                                        console.log(note);
                                                                    }
                                                                } else {
                                                                    if(loc[loc.length-1].short_name == ogeofenceName){
                                                                        __tempStat = getStat_Time(loc[loc.length-1].events);
                                                                    }
                                                                    if(__tempStat == null) {
                                                                        __tempStat = "assigned";
                                                                        late_data_entry = false;
                                                                        console.log("__tempStat is null but vehicle is inside origin.");
                                                                    }
                                                                    note = "Truck selected is within the origin.";
                                                                    console.log(note);
                                                                }

                                                                importData.status = __tempStat || "assigned";
        
                                                                if(__tempStat == null) {
                                                                    // commented because not sure what proper note to put
                                                                    // note = " Truck selected is not within the origin and destination. It is assumed that the truck is enroute to origin.";
                                                                    console.log(`Truck selected is not within the origin. | ${__tempStat} - Assigned`);
                                                                }
                                                                var tempEventsCaptured = OBJECT.sortByKey(__events_captured);
                                                                __events_captured = tempEventsCaptured;
                                                                
                                                                console.log("EYOOOEOEOEOOEOEO",late_data_entry,__tempStat,__events_captured);
                                                                importData.events_captured = __events_captured;
                                                                importData.late_entry = late_data_entry;

                                                                if(late_data_entry === true) {
                                                                    var inTransitKey = OBJECT.getKeyByValue(__events_captured,"in_transit");

                                                                    var date =  (inTransitKey) ? new Date(Number(inTransitKey)) : new Date(),
                                                                        transit_time = HH_MM(null,rDoc.transit_time),
                                                                        hours = transit_time.hour,
                                                                        minutes = transit_time.minute;

                                                                    importData.departure_date = date.toISOString();
                                                                    importData.destination[0].etd = date.toISOString();
                                
                                                                    (hours)?date.setHours(date.getHours() + Number(hours)):null;
                                                                    (minutes)?date.setMinutes(date.getMinutes() + Number(minutes)):null;
                                                                    console.log("new date",date);
                                                                    
                                                                    importData.destination[0].eta = date.toISOString();
                                                                }
                                                                
                                                                saveData();
                                                            };
        
                                                            vehicleAjax(late_data_entry);
                                                        } catch(error2){
                                                            console.log("error2,",typeof body2,error2);
                                                            client.close();
                                                            res.status(500).send("Internal Server Error");
                                                        }
                                                    } else {
                                                        if(error) console.log("Vehicle Request Error", error.toString());
                                                        client.close();
                                                        res.status(500).send("Internal Server Error");
                                                    }
                                                });
                                            } else {
                                                if(error) console.log("Token Request Error", error.toString());
                                                client.close();
                                                res.status(500).send("Internal Server Error");
                                            }
                                        });
                                    } else {
                                        // submit
                                        importData.events_captured = {};
                                        importData.late_entry = null;
                                        saveData();
                                    }
                                });
                            });
                        }
                    }
                });
            } else if (method == "GET") {
                // query.sn = query.sn || "";
                // var shipment_numbers = query.sn .split(",") || [];
                // dispatchCollection.find({_id: {$in: shipment_numbers},username: "_API_"}).toArray((err,docs)=>{
                //     if(err) {
                //         console.log("Get Error",err.toString());
                //         res.status(500).send("Internal Server Error");
                //     } else {
                //         var dispatchArr = [];
                //         docs.forEach(val => {
                //             val.destination[0] = val.destination[0] || {};
                //             dispatchArr.push({
                //                 shipment_number: val._id,
                //                 origin: val.origin,
                //                 destination: val.destination[0].location,
                //                 route: val.route,
                //                 departure_date: val.departure_date,
                //                 vehicle: val.vehicle,
                //                 etd: val.destination[0].etd,
                //                 eta: val.destination[0].eta,
                //                 comments: val.comments,
                //                 status: val.status,
                //                 late_entry: val.late_entry,
                //                 posting_date: val.posting_date,
                //             });
                //         });
                //         client.close();
                //         console.log(JSON.stringify(docs));
                //         res.status(200).send(dispatchArr);
                //     }
                // });
                res.status(200).send("-");
            } else {
                console.log("Invalid method",method);
                res.status(400).send("Bad Request");
            }
        } else {
            console.log("Invalid url request",params);
            res.status(400).send("Bad Request");
        }
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};