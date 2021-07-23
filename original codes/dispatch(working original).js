const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

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
        body = body.data;

        console.log("Method",method);
        console.log("Body",JSON.stringify(method));
        console.log("Query",query);
        console.log("Params",params);

        if(clientName && urlTag == "import" && secretkey && CLIENTS[clientName] == secretkey){
            const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
                  db = client.db(`wd-${clientName}`),
                  dispatchCollection = db.collection('dispatch'),
                  geofencesCollection = db.collection('geofences');

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
                                var index = body.findIndex(x => x.shipment_number == _id);
                                body.splice(index,1);
                            });
                        }
                    },
                    shipment_numbers = [],
                    dups_shipment_number = [],
                    dcs = [],
                    importData = [];
                // check if there are duplicates of shipment number in import data
                var valueArr = body.map(function(item){ return item.shipment_number });
                var dupsArr = valueArr.filter(function(item, idx){ 
                    return valueArr.indexOf(item, idx + 1) !== -1; 
                });
                dupsSN(dupsArr,"Duplicate Shipment Number.");
            
                // check if shipment number exists in database
                body.forEach(item => {
                    shipment_numbers.push(item.shipment_number);
                    (dcs.includes(item.origin)) ? null : dcs.push(item.origin);
                    (dcs.includes(item.destination)) ? null : dcs.push(item.destination);
                });
            
                dispatchCollection.find({_id: {$in: shipment_numbers}}).toArray((err,docs)=>{
                    if(err) {
                        console.log("Get Error",err.toString());
                        res.status(500).send("Internal Server Error");
                    } else {
                        docs.forEach(item => {
                            dups_shipment_number.push(item._id);
                        });
                        dupsSN(dups_shipment_number,"Shipment Number already exists in database.");
            
                        // loop through array
                            // get origin data
                            // get destination data
                            // get route
                        if(body.length > 0){
                            geofencesCollection.aggregate([
                                {
                                    $match: {short_name: {$in: dcs}}
                                },
                                { 
                                    $lookup: {
                                        from: 'routes',
                                        localField: '_id',
                                        foreignField: 'origin_id',
                                        as: 'route',
                                    }
                                },
                            ]).toArray().then(gDocs=>{
                                body.forEach(item => {
                                    var origin = gDocs.find(x => x.short_name == item.origin) || {route:[]},
                                        destination = gDocs.find(x => x.short_name == item.destination) || {},
                                        route = origin.route.find(x => x.origin_id.toString() == origin._id.toString() && x.destination_id.toString() == destination._id.toString()) || {},
                                        errorMessage = "";
                                    console.log("origin",origin);
                                    console.log("route",route);
                                    // should be in this order so that if origin is invalid, it will show first.
                                    (!route._id) ? errorMessage = "Invalid route." : null;
                                    (!destination._id) ? errorMessage = "Invalid destination." : null;
                                    (!origin._id) ? errorMessage = "Invalid origin." : null;
            
                                    if(errorMessage){
                                        addError({
                                            "Shipment Number": item.shipment_number,
                                            "Message": errorMessage
                                        });
                                    } else {
                                        importData.push({
                                            _id: item.shipment_number,
                                            origin: origin.short_name,
                                            origin_id: origin._id,
                                            route: route._id,
                                            destination: [{
                                                location: destination.short_name,
                                                location_id: destination._id,
                                                transit_time: route.transit_time,
                                                cico: destination.cico,
                                            }],
                                            vehicle: {}, // so that it will not cause error in main.js
                                            status: "plan",
                                            posting_date: moment(new Date()).toISOString(),
                                            comments: item.comments || "",
                                            username: "_API_"
                                        });
                                    }
                                });
                                if(importData.length > 0){
                                    // res.json({ok:1,importData,error:_error_});
                                    dispatchCollection.insertMany(importData,(err,result)=>{
                                        if(err){
                                            console.log("Insert Error",err.toString());
                                            res.status(500).send("Internal Server Error");
                                        } else {
                                            // client.close();
                                            res.status(200).send({nInserted:importData.length, error:_error_});
                                        }
                                    });
                                } else {
                                    res.status(200).send({nInserted:importData.length, error:_error_});
                                }
                            });
                        } else {
                            res.status(200).send({nInserted:importData.length, error:_error_});
                        }
                    }
                });
            } else if (method == "GET") {
                query.sn = query.sn || "";
                var shipment_numbers = query.sn .split(",") || [];
                dispatchCollection.find({_id: {$in: shipment_numbers},username: "_API_"}).toArray((err,docs)=>{
                    if(err) {
                        console.log("Get Error",err.toString());
                        res.status(500).send("Internal Server Error");
                    } else {
                        var dispatchArr = [];
                        docs.forEach(val => {
                            val.destination[0] = val.destination[0] || {};
                            dispatchArr.push({
                                shipment_number: val._id,
                                origin: val.origin,
                                destination: val.destination[0].location,
                                route: val.route,
                                cico: val.destination[0].cico,
                                transit_time: val.destination[0].transit_time,
                                departure_date: val.departure_date,
                                vehicle: val.vehicle,
                                etd: val.destination[0].etd,
                                eta: val.destination[0].eta,
                                comments: val.comments,
                                status: val.status,
                                late_entry: val.late_entry,
                                posting_date: val.posting_date,
                            });
                        });
                        client.close();
                        console.log(JSON.stringify(docs));
                        res.status(200).send(dispatchArr);
                    }
                });
            } else {
                console.log("Invalid method",method);
                res.status(400).send("Bad Request");
            }
        } else {
            console.log("Invalid url request",params);
            res.status(400).send("Bad Request");
        }
    }).catch(error => {
        console.log("Error",error.toString(),);
        res.status(500).send("Internal Server Error");
    });
};