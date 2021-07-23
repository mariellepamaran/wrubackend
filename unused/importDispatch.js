const co = require('co');
const mongodb = require('mongodb');
const ObjectID = require('mongodb').ObjectID;

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.importDispatch = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        var childPromise = [];

        var client = yield mongodb.MongoClient.connect(uri),
            process = function(clientName){
                const db = client.db(`wd-${clientName}`),
                      dispatchCollection = db.collection('dispatch');

                    dispatchCollection.aggregate([
                        {
                            $match: {vehicle_id:{$exists:false}}
                        },
                        { 
                            $lookup: {
                                from: 'geofences',
                                localField: 'origin',
                                foreignField: 'short_name',
                                as: '_origin',
                            }
                        },
                        { 
                            $lookup: {
                                from: 'geofences',
                                localField: 'destination.0.location',
                                foreignField: 'short_name',
                                as: '_destination',
                            }
                        },
                        { 
                            $lookup: {
                                from: 'vehicles',
                                localField: 'vehicle.username',
                                foreignField: 'username',
                                as: '_vehicle',
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
                        { $unwind: { path: "$_origin", preserveNullAndEmptyArrays: true } },
                        { $unwind: { path: "$_destination", preserveNullAndEmptyArrays: true } },
                        { $unwind: { path: "$route", preserveNullAndEmptyArrays: true } },
                        { $unwind: { path: "$_vehicle", preserveNullAndEmptyArrays: true } },
                    ]).toArray().then(docs=>{
                        docs.forEach(val => {
                            var set = {}, unset = {};
                            var update = {};
                            val._origin = val._origin;
                            val._destination = val._destination;
                            val.route = val.route;
                            val._vehicle = val._vehicle;
                            val.destination[0] = val.destination[0] || {};
                    
                            if(val._origin){
                                set.origin_id = ObjectID(val._origin._id);
                            } else {
                                unset.origin_id = "";
                            }
                            if(val._destination){
                                set["destination.0.location_id"] = ObjectID(val._destination._id);
                            } else {
                                unset["destination.0.location_id"] = "";
                            }
                            if(val._vehicle){
                                set.vehicle_id = val._vehicle._id;
                            } else {
                                unset.vehicle_id = "";
                            }
                            if(Object.keys(set).length > 0){
                                update["$set"] = set;
                            }
                            if(Object.keys(unset).length > 0){
                                update["$unset"] = unset;
                            }
                            childPromise.push(dispatchCollection.updateOne({_id:val._id},update));
                        });
                        done();
                    });
            },
            done = function(){
                Promise.all(childPromise).then(result => { 
                    client.close();
                    res.status(200).send("OK");
                }).catch(error => { 
                    console.log("Promise error",error.toString());
                    res.status(500).send('Error: ' + JSON.stringify(error));
                 });
            };

        /************** START OF PROCESS **************/
        process("coket1");
        /************** END OF PROCESS **************/
    }).catch(error => {
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};