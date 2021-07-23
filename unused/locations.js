const co = require('co');
const mongodb = require('mongodb');
const ObjectId = require('mongodb').ObjectID;

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.locations = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    co(function*() {
        console.log("Method: ",req.method);
        console.log("Params: ",req.params);
        console.log("Query: ",req.query);
        console.log("Body: ",JSON.stringify(req.body));

        var method = req.method,
            body = req.body,
            params = req.params[0],
            params_value = params.split("/");

        const userId = Number(params_value[0]);
        
        console.log(`User ID: ${userId}  |  Authorization header: ${req.headers.authorization}`);

        if(req.headers.authorization === "395d8ef62b8a4de" && userId){
            const client = yield mongodb.MongoClient.connect(uri),
                  db = client.db('wru'),
                  locationsCollection = db.collection('locations'),
                  usersCollection = db.collection('users'),
                  logsCollection = db.collection('logs'),
                  title = {
                      region: "Distribution Manager",
                      cluster: "Operations Manager",
                      dc: "Warehouse Head"
                  };
            
            yield logsCollection.insertOne({  // always change depending on function's name
                function_name:"locations",
                method,
                data: JSON.stringify(body),
                request_info: JSON.stringify({authorization:req.headers.authorization,params,query: req.query}),
                userId
            });
            if (method == 'OPTIONS') {
                res.status(204).send('');
            } else if(method === "POST"){
                if(parameterComplete(["type"],body)) {
                    var docs = null,
                        types = ["region","cluster","dc"];
                    if(types.includes(body.type)){
                        if(body.type == "region"){
                            docs = yield locationsCollection.updateOne(
                                { "region":body.region }, 
                                { $setOnInsert: { "region":body.region, "assigned":body.assigned, "cluster": [] } },
                                { upsert: true }
                            );
                        }
                        if(body.type == "cluster"){
                            docs = yield locationsCollection.updateOne(
                                { "region":body.region }, 
                                { $push: { "cluster": { "name": body.cluster, "assigned":body.assigned, "dc":[] } }},
                                { upsert: true });
                        }
                        if(body.type == "dc"){
                            docs = yield locationsCollection.updateOne(
                                { 
                                    "region":body.region, 
                                    "cluster": {
                                        $elemMatch: {
                                            "name": body.cluster
                                        }
                                    }  
                                }, 
                                {
                                    $push: {
                                        "cluster.$.dc": {
                                            "name": body.dc,
                                            "short_name": body.short_name,
                                            "code": body.code,
                                            "assigned": body.assigned,
                                            "cico": body.cico || 0
                                        }
                                    }
                                },
                                { upsert: true }
                            );
                        }
                        setUserTitle(body.assigned,title[body.type]).then(() => {
                            closeConnection(docs);
                        });
                    } else {
                        res.status(400).send('Error: Invalid parameter/s');
                    }
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "PUT"){
                var _id = params_value[1];
                if(isEmpty([userId,_id]) === true){
                    res.status(400).send('Error: Missing parameters');
                } else {
                    var docs = null,
                    types = ["region","cluster","dc"];
                    if(types.includes(body.type)){
                        if(body.type == "region"){
                            docs = yield locationsCollection.updateOne({"_id":ObjectId(_id)}, 
                            { $set: { 'region': body.region, 'assigned': body.assigned } });
                        }
                        if(body.type == "cluster"){
                            var obj = {};
                            obj[`cluster.${body.index}.name`] = body.cluster;
                            obj[`cluster.${body.index}.assigned`] = body.assigned;
                            docs = yield locationsCollection.updateOne({"_id":ObjectId(_id)}, 
                            { $set: obj });
                        }
                        if(body.type == "dc"){
                            var obj = {};
                            obj[`cluster.${body.c_index}.dc.${body.index}.name`] = body.dc;
                            obj[`cluster.${body.c_index}.dc.${body.index}.short_name`] = body.short_name;
                            obj[`cluster.${body.c_index}.dc.${body.index}.code`] = body.code;
                            obj[`cluster.${body.c_index}.dc.${body.index}.assigned`] = body.assigned;
                            obj[`cluster.${body.c_index}.dc.${body.index}.cico`] = body.cico || 0;
                            docs = yield locationsCollection.updateOne({"_id":ObjectId(_id)},
                            { $set: obj });
                        }
                        setUserTitle(body.assigned,title[body.type]).then(() => {
                            closeConnection(docs);
                        });
                    } else {
                        res.status(400).send('Error: Invalid parameter/s');
                    }
                }
            } else if(method === "DELETE"){
                if(parameterComplete(null,params_value)) {
                    var _id = params_value[1];
                    if(isEmpty([userId,_id]) === true){
                        res.status(400).send('Error: Missing parameters');
                    } else {
                        var docs = null,
                        types = ["region","cluster","dc"];
                        if(types.includes(body.type)){
                            if(body.type == "region"){
                                docs = yield locationsCollection.deleteOne({"_id":ObjectId(_id)});
                            }
                            if(body.type == "cluster"){
                                docs = yield locationsCollection.updateOne({"_id":ObjectId(_id)}, 
                                { $pull: { 'cluster': { name: body.cluster } } });
                            }
                            if(body.type == "dc"){
                                docs = yield locationsCollection.updateOne({"_id":ObjectId(_id)},
                                { $pull: { 'cluster.$[].dc': { name: body.dc } } });
                            }
                            closeConnection(docs);
                        } else {
                            res.status(400).send('Error: Invalid parameter/s');
                        }
                    }
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else {
                res.status(400).send('Error: Method invalid.');
            }

            function closeConnection(docs){
                console.log(JSON.stringify(docs));
                client.close();
                res.status(200).send(docs);
            }
            function setUserTitle(assigned,title){
                return new Promise((resolve,reject) => {
                    var childPromise = [];
                    assigned.forEach(username => {
                        childPromise.push(usersCollection.updateOne({username},{$set: {title}}));
                    });
                    Promise.all(childPromise).then(data => {
                        resolve();
                    }).catch(error => {
                        reject();
                    });
                });
            }
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
        } else {
            res.status(200).send({
                "error": "Unauthorized"
            });
        }
    }).catch(function(error) {
        console.log(JSON.stringify(error));
        res.status(500).send('Error: ' + error.toString());
    });
};