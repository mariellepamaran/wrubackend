/**
 * truck
 * 
 * >> Retrieve vehicle data by Plate Number <<
 * 
 * specifically made for Sir Binky
 * 
 */

const co = require('co');
const mongodb = require('mongodb');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

const clientApplicationId = {
    "9":   "wd-coket1",
    "4":   "wd-coket2",
    "427": "wd-wilcon",
};

// named "truck" so that we can differentiate from vehicles function
exports.truck = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET');

    co(function*() {
        // query parameters
        const query = req.query;

        // fields from query params
        const appId = query.appId;
        const plate_number = query.plate_number;

        // get client db name by appId
        const clientName = clientApplicationId[appId];

        console.log("Query:",JSON.stringify(query));
            
        if(clientName){
            if(plate_number){
                // initialize mongoDb Client
                const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });
        
                // initialize database
                const db = client.db(clientName);
                const vehiclesCollection = db.collection('vehicles');
              
                // retrieve vehicle by Plate Number
                vehiclesCollection.find({ name: plate_number.toUpperCase() }).toArray().then(docs => {
                    const doc = docs[0];
                    if(doc){
                        // close the mongodb client connection
                        client.close();
                        
                        // return success status and data needed by Sir Binky
                        res.status(200).send({
                            ok: 1,
                            data: {
                                "id": doc._id,
                                "Pal Cap": doc["Pal Cap"],
                                "Trailer": doc["Trailer"],
                                "Availability": doc["Availability"],
                                "Tractor Conduction": doc["Tractor Conduction"],
                            }
                        });
                    } else {
                        // close the mongodb client connection
                        client.close();

                        // return error with message
                        res.status(500).send({
                            error: 1,
                            message: "Plate number does not exist."
                        });
                    }
                });
            } else {
                // return error with message
                res.status(500).send({
                    error: 1,
                    message: "Missing query parameter/s."
                });
            }
        } else {
            // return error with message
            res.status(500).send({
                error: 1,
                message: "Invalid appId."
            });
        }
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};