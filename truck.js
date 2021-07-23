const co = require('co');
const mongodb = require('mongodb');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

const clientApplicationId = {
    "9": "coket1",
    "4": "coket2",
    "427": "wilcon",
};
// names "truck" so that we can differentiate from vehicles function
// specifically made for Sir Binky
exports.truck = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET');

    co(function*() {
        var query = req.query,
            appId = query.appId,
            plate_number = query.plate_number,
            clientName = clientApplicationId[appId];
        if(clientName){
            if(plate_number){
                var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });

                console.log("Query:",JSON.stringify(query));
        
                const db = client.db(`wd-${clientName}`),
                      vehiclesCollection = db.collection('vehicles');
              
                vehiclesCollection.find({name: plate_number.toUpperCase()}).toArray().then(docs => {
                    var doc = docs[0];
                    if(doc){
                        var sendData = {
                            "id": doc._id,
                            "Pal Cap": doc["Pal Cap"],
                            "Trailer": doc["Trailer"],
                            "Availability": doc["Availability"],
                            "Tractor Conduction": doc["Tractor Conduction"],
                        };
                        res.status(200).send({
                            ok: 1,
                            data: sendData
                        });
                    } else {
                        res.status(500).send({
                            error: 1,
                            message: "Plate number does not exist."
                        });
                    }
                });
            } else {
                res.status(500).send({
                    error: 1,
                    message: "Missing query parameter/s."
                });
            }
        } else {
            res.status(500).send({
                error: 1,
                message: "Invalid appId."
            });
        }
    }).catch(error => {
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};