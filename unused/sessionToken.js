const co = require('co');
const mongodb = require('mongodb');
const credentials = {
    mongodb: {
        uri: "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority",
        appId: "wru_dispatch-wmhvm",
    },
    wru: {
        appId: 9,
    }
};

exports.sessionToken = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    
    co(function*() {
        console.log("Method: ",req.method);
        console.log("Params: ",req.params);
        console.log("Body: ",req.body);

        var method = req.method,
            body = req.body,
            params = req.params["0"],
            params_value = params.split("/");

        const username = params_value[0];
        
        console.log(`Username: ${username}  |  Authorization header: ${req.headers.authorization}`);

        if(req.headers.authorization === "395d8ef62b8a4de"){
            const client = yield mongodb.MongoClient.connect(credentials.mongodb.uri),
                  db = client.db('wru'),
                  sessionsCollection = db.collection('sessions'),
                  logsCollection = db.collection('logs');

            // not saving GET and POST because it may take too much space on DB.
            if(method == "DELETE"){
                yield logsCollection.insertOne({ // always change depending on function's name
                    function_name:"sessionToken",
                    method,
                    data: JSON.stringify(body),
                    request_info: JSON.stringify({authorization:req.headers.authorization,params,query: req.query}),
                    username
                });
            }
            
            if (method == 'OPTIONS') {
                res.status(204).send('');
            } else if(method === "POST"){
                if(parameterComplete(["_id","apiKey","expiry","timestamp","device_info"],body)) {
                    var myobj = { 
                        _id: body._id, 
                        apiKey: body.apiKey, 
                        username, 
                        expiry: body.expiry, 
                        timestamp: body.timestamp, 
                        device_info: body.device_info, 
                    };
                    const docs = yield sessionsCollection.insertOne(myobj);
                    client.close();
                    res.status(200).send(docs);
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "GET"){
                if(parameterComplete(null,params_value)) {
                    var _id = params_value[0],
                        development = params_value[1]; // optional
                    sessionsCollection.findOneAndUpdate({_id}, {   
                        $set: {
                            timestamp: new Date().toISOString()
                        }
                    }, {returnOriginal: false}, function(err, docs){
                        if(err){
                            client.close();
                            res.status(500).send('Error: ' + error.toString());
                        } else {
                            // console.log(docs);
                            if(development){
                                credentials.mongodb.appId = "wru-dev-rbagv";
                            }
                            client.close();
                            res.status(200).send({
                                tokens: docs.value,
                                credentials
                            });
                        }
                    });
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "DELETE"){
                if(parameterComplete(null,params_value)) {
                    var _id = params_value[1];
                    if(isEmpty([username,_id]) === true){
                        res.status(400).send('Error: Missing parameters');
                    } else {
                        const docs = yield sessionsCollection.deleteOne({username,_id});
                        client.close();
                        res.status(200).send(docs);
                    }
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else {
                res.status(400).send('Error: Method invalid.');
            }
        } else {
            res.status(200).send({
                "error": "Unauthorized"
            });
        }
    }).catch(error => {
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