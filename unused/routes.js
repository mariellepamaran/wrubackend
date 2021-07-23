const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.routes = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    co(function*() {
        console.log("Method: ",req.method);
        console.log("Params: ",req.params);
        console.log("Query: ",req.query);
        console.log("Body: ",req.body);

        var method = req.method,
            body = req.body,
            params = req.params[0],
            params_value = params.split("/");

        const userId = Number(params_value[0]);
        
        console.log(`User ID: ${userId}  |  Authorization header: ${req.headers.authorization}`);

        if(req.headers.authorization === "395d8ef62b8a4de" && userId){
            const client = yield mongodb.MongoClient.connect(uri),
                  db = client.db('wru'),
                  routesCollection = db.collection('routes'),
                  logsCollection = db.collection('logs');
            
            yield logsCollection.insertOne({  // always change depending on function's name
                function_name:"routes",
                method,
                data: JSON.stringify(body),
                request_info: JSON.stringify({authorization:req.headers.authorization,params,query: req.query}),
                userId
            });
            if (method == 'OPTIONS') {
                res.status(204).send('');
            } else if(method === "POST"){
                if(parameterComplete(["_id","origin","destination","transit_time"],body)) {
                    var docs = yield routesCollection.insertOne({
                        _id: body._id,
                        origin: body.origin,
                        destination: body.destination,
                        transit_time: Number(body.transit_time),
                        userId,
                        timestamp: new Date().toISOString(),
                    });
                    closeConnection(docs);
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "PUT"){
                if(parameterComplete(["origin","destination","transit_time"],body) && parameterComplete(null,params_value)) {
                    var _id = params_value[1];
                    if(isEmpty([userId,_id]) === true){
                        res.status(400).send('Error: Missing parameters');
                    } else {
                        var docs = yield routesCollection.updateOne(
                            { _id }, 
                            {
                                $set: {
                                    origin: body.origin,
                                    destination: body.destination,
                                    transit_time: Number(body.transit_time),
                                }
                            });
                        closeConnection(docs);
                    }
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "DELETE"){
                if(parameterComplete(null,params_value)) {
                    var _id = params_value[1];
                    if(isEmpty([userId,_id]) === true){
                        res.status(400).send('Error: Missing parameters');
                    } else {
                        var docs = yield routesCollection.deleteOne({_id});
                        closeConnection(docs);
                    }
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else {
                res.status(400).send('Error: Method invalid.');
            }

            function closeConnection(docs){
                console.log(docs);
                client.close();
                res.status(200).send(docs);
            }
        } else {
            res.status(200).send({
                "error": "Unauthorized"
            });
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error: ' + error.toString());
    });

    function parameterComplete(list,params){
        if(list){
            var valid = true;
            for(var i=0; i<list.length; i++){
                (params[list[i]]) ? null : valid = false;
            }
            return (valid === true) ? true : false;
        } else {
            return (params.length > 0) ? true : false;
        }
    }
    function isEmpty(strArr){
        var empty = false;
        for(var i=0;i<strArr.length;i++){
            strArr[i] = JSON.stringify(strArr[i]) || "";
            (strArr[i].trim() == "") ? empty = true : null;
        }
        return empty;
    }
};