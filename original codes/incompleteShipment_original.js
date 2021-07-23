const co = require('co');
const mongodb = require('mongodb');

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.incompleteShipment = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        var client = yield mongodb.MongoClient.connect(uri),
            CLIENTS = {
                  "coket1":null,
                  "wilcon":null,
            },
            process = function(clientName){
                const db = client.db(`wd-${clientName}`),
                      dispatchCollection = db.collection('dispatch');

                dispatchCollection.find({ status: "in_transit" }).toArray().then(docs => {
                    var _ids = [];
                    docs.forEach(val => {
                        val.event_time = val.event_time || {};
                        val.destination = val.destination || [];
                        if(val.event_time.in_transit && val.destination[0]) {
                            var transitDH = (((new Date().getTime() - new Date(val.event_time.in_transit).getTime())/3600)/1000);
                            var leeway = Number(val.destination[0].transit_time) + 12;
                            console.log("_id",val._id,"transitDH",transitDH,"leeway",leeway);
                            if(transitDH > leeway){
                                _ids.push(val._id);
                            }
                        }
                    });
                    console.log("_ids",JSON.stringify(_ids));
        
                    if(_ids.length > 0){
                        var set = {status: "incomplete"};
                        set[`event_time.incomplete`] = new Date().toISOString();
                        dispatchCollection.updateMany({_id: {$in: _ids}}, {$set: set}).then(() => {
                            areClientsDone(clientName);
                        }).catch(error => {
                            client.close();
                            console.log('Error: ' + JSON.stringify(error));
                            res.status(500).send('Error: ' + JSON.stringify(error));
                        });
                    } else {
                        areClientsDone(clientName);
                    }
                }).catch(error => {
                    console.log('Error: ' + JSON.stringify(error));
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
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};