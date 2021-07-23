const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.eventsCT2 = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var method = req.method,
            body = req.body,
            query = req.query,
            params = req.params[0],
            params_value = params.split("/");

        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
              dbLogging = client.db('wd-coket2-logging'),
              eventsCollection = dbLogging.collection('events');

        console.log("Method:",method);
        console.log("Body:",JSON.stringify(body));
        console.log("Query:",JSON.stringify(query));

        if(method === "DELETE"){
            var _id = params_value[0];
            if(_id && _id.trim() === ""){
                res.status(400).send('Error: Missing parameters');
            } else {
                var docs = yield eventsCollection.deleteOne({_id});
                client.close();
                res.status(200).send(docs);
            }
        } else {
            if(query.RULE_NAME == "Check Out"){
                var date = new Date(query["Event start time"]+"Z"),
                    event = {
                        GEOFENCE_NAME: query.GEOFENCE_NAME,
                        RULE_NAME: query.RULE_NAME,
                        GEOFENCE_ID: query.GEOFENCE_ID,
                        stage: query.stage,
                        USER_NAME: query.USER_NAME,
                        USER_USERNAME: query.USER_USERNAME,
                        ASSIGNED_VEHICLE_ID: query.ASSIGNED_VEHICLE_ID,
                        Region: query.Region,
                        Cluster: query.Cluster,
                        Site: query.Site,
                        geofence_type: (query.GEOFENCE_NAME.indexOf(" PL") > -1) ? "PL" : "DC",
                        timestamp: moment(date).toISOString(),
                        iamme:true
                    };

                eventsCollection.insertOne(event).then(docs => {
                    console.log("docs: ",JSON.stringify(docs));
                    client.close();
                    res.status(200).send("OK");
                }).catch(error => {
                    console.log(JSON.stringify(error));
                    client.close();
                    res.status(500).send('Error in CN: ' + JSON.stringify(error));
                }); 
            } else {
                client.close();
                res.status(200).send("OK");
            }         
        }
    }).catch(function(error) {
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};