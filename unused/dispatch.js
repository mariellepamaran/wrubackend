const co = require('co');
const mongodb = require('mongodb');
const fs = require('fs');
const {Storage} = require('@google-cloud/storage');

var storage = null,
    bucket = null;

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.dispatch = (req, res) => {
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
        // params_value.shift();

        const userId = Number(params_value[0]);
        
        console.log(`User ID: ${userId}  |  Authorization header: ${req.headers.authorization}`);

        // params_value[0] => "remarks"
        if(req.headers.authorization === "395d8ef62b8a4de" && params_value[0]){
            const client = yield mongodb.MongoClient.connect(uri),
                  db = client.db('wru'),
                  dispatchCollection = db.collection('dispatch'),
                  logsCollection = db.collection('logs');

            yield logsCollection.insertOne({  // always change depending on function's name
                function_name:"dispatch",
                method,
                data: JSON.stringify(body),
                request_info: JSON.stringify({authorization:req.headers.authorization,params,query: req.query}),
                userId
            });
            if (method == 'OPTIONS') {
                res.status(204).send('');
            } else if(method === "POST"){
                if(body.type == "many") {
                    if(parameterComplete(["importData"],body)) {
                        dispatchCollection.insertMany(body.importData).then(docs => {
                            closeConnection(docs);
                        }).catch(error => {
                            client.close();
                            res.status(500).send('Error: ' + error.toString());
                        });
                    } else {
                        res.status(400).send('Error: Missing parameters');
                    }
                } else {
                    /** EDITED */
                    if(body.status == "plan"){
                        if(parameterComplete(["_id","userId"],body)) {
                        var obj = { 
                            _id: body._id.toString(),
                            // shipment_number: body.shipment_number,
                            planning_date: body.planning_date || new Date().toISOString(),
                            departure_date: body.departure_date || new Date().toISOString(),
                            origin: body.origin || "",
                            origin_id: body.origin_id || "",
                            route: body.route || "",
                            destination: body.destination || [],
                            vehicle: body.vehicle || {},
                            status: body.status || "plan",
                            posting_date: new Date().toISOString(),
                            userId
                        },
                        ATTACHMENTS = [];
                        (body.comments) ? obj.comments = body.comments : null;

                        if(body.attachment && body.attachment.length > 0){
                            obj.attachment = body.attachment;
                            obj.attachment.forEach(function(val,i){
                                ATTACHMENTS.push({
                                    base64: val.base64,
                                    storageFilename: val.storageFilename,
                                });
                                delete obj.attachment[i].base64;
                            });
                        }

                        dispatchCollection.insertOne(obj).then(docs => {
                            if(ATTACHMENTS.length > 0){
                                initializeStorage();
                                var totalAttachments = ATTACHMENTS.length,
                                    uploadedAttachments = 0;
                                ATTACHMENTS.forEach(function(val){
                                    uploadAttachments(val.base64,val.storageFilename).then(() => {
                                        uploadedAttachments++;
                                        if(totalAttachments == uploadedAttachments){
                                            closeConnection(docs);
                                        }
                                    }).catch(error => {
                                        console.log("Error Uploading: ",JSON.stringify(error));
                                        closeConnection(docs);
                                    });
                                });
                            } else {
                                closeConnection(docs);
                            }
                        }).catch(error => {
                            client.close();
                            res.status(500).send('Error: ' + error.toString());
                        });
                    } else {
                        res.status(400).send('Error: Missing parameters');
                    }
                    } else {
                        if(parameterComplete(["_id","planning_date","departure_date","origin","origin_id","route",
                                    "destination","vehicle","userId"],body)) {
                            var obj = { 
                                _id: body._id.toString(),
                                // shipment_number: body.shipment_number,
                                planning_date: body.planning_date,
                                departure_date: body.departure_date,
                                origin: body.origin,
                                origin_id: body.origin_id,
                                route: body.route,
                                destination: body.destination,
                                vehicle: body.vehicle,
                                status: body.status || "plan",
                                posting_date: new Date().toISOString(),
                                userId
                            },
                            ATTACHMENTS = [];
                            (body.comments) ? obj.comments = body.comments : null;

                            if(body.attachment && body.attachment.length > 0){
                                obj.attachment = body.attachment;
                                obj.attachment.forEach(function(val,i){
                                    ATTACHMENTS.push({
                                        base64: val.base64,
                                        storageFilename: val.storageFilename,
                                    });
                                    delete obj.attachment[i].base64;
                                });
                            }

                            dispatchCollection.insertOne(obj).then(docs => {
                                if(ATTACHMENTS.length > 0){
                                    initializeStorage();
                                    var totalAttachments = ATTACHMENTS.length,
                                        uploadedAttachments = 0;
                                    ATTACHMENTS.forEach(function(val){
                                        uploadAttachments(val.base64,val.storageFilename).then(() => {
                                            uploadedAttachments++;
                                            if(totalAttachments == uploadedAttachments){
                                                closeConnection(docs);
                                            }
                                        }).catch(error => {
                                            console.log("Error Uploading: ",JSON.stringify(error));
                                            closeConnection(docs);
                                        });
                                    });
                                } else {
                                    closeConnection(docs);
                                }
                            }).catch(error => {
                                client.close();
                                res.status(500).send('Error: ' + error.toString());
                            });
                        } else {
                            res.status(400).send('Error: Missing parameters');
                        }
                    }
                    
                    /** EDITED */
                }
            } else if(method === "GET"){
                if(parameterComplete(null,params_value)) {
                    var docs = null,
                        _id = params_value[1];
                    if(params_value.length === 1){
                        docs = yield dispatchCollection.find({userId}).toArray();
                    } else {
                        docs = yield dispatchCollection.find({userId,_id}).toArray();
                    }
                    closeConnection(docs);
                } else {
                    res.status(400).send('Error: Missing parameters');
                }
            } else if(method === "PUT"){
                var docs = null,
                    _id = params_value[1],
                    isRemarks = (params_value[0] == "remarks")?true:false;
                if(isEmpty([userId,_id]) === true){
                    res.status(400).send('Error: Missing parameters');
                } else {
                    initializeStorage();

                    var obj = {},
                        unset_obj = {},
                        update_obj = {},
                        valid_status = ["plan","dispatch","queueingAtOrigin","processingAtOrigin","in_transit","queueingAtDestination","processingAtDestination","complete","incomplete"],
                        ATTACHMENTS = [];
                    // (body.shipment_number) ? obj.shipment_number = body.shipment_number : null;
                    (body.planning_date) ? obj.planning_date = body.planning_date : null;
                    (body.departure_date) ? obj.departure_date = body.departure_date : null;
                    (body.origin) ? obj.origin = body.origin : null;
                    (body.origin_id) ? obj.origin_id = body.origin_id : null;
                    (body.route) ? obj.route = body.route : null;
                    (body.destination) ? obj.destination = body.destination : null;
                    (body.vehicle) ? obj.vehicle = body.vehicle : null;
                    (body.comments) ? obj.comments = body.comments : null;
                    (body.wh_remarks) ? obj.wh_remarks = body.wh_remarks : null;
                    (body.wh_remarks_timestamp) ? obj.wh_remarks_timestamp = body.wh_remarks_timestamp : null;
                    (body.om_remarks) ? obj.om_remarks = body.om_remarks : null;
                    (body.om_remarks_timestamp) ? obj.om_remarks_timestamp = body.om_remarks_timestamp : null;
                    (body.dm_remarks) ? obj.dm_remarks = body.dm_remarks : null;
                    (body.dm_remarks_timestamp) ? obj.dm_remarks_timestamp = body.dm_remarks_timestamp : null;
                    (body.remarks != null) ? obj[`remarks.${body.delay_type}`] = body.remarks : null;

                    if(valid_status.includes(body.status)){
                        obj.status = body.status;
                        obj[`event_time.${obj.status}`] = new Date().toISOString();
                        unset_obj.escalation1 = "";
                        unset_obj.escalation2 = "";
                        unset_obj.escalation3 = "";
                    } else {
                        if(body.attachment && body.attachment.length > 0){
                            obj.attachment = body.attachment;
                            obj.attachment.forEach(function(val,i){
                                ATTACHMENTS.push({
                                    base64: val.base64,
                                    storageFilename: val.storageFilename,
                                });
                                delete obj.attachment[i].base64;
                            });
                        } else {
                            unset_obj["attachment"] = "";
                        }
                    }
                    update_obj["$set"] = obj;
                    (Object.keys(unset_obj).length > 0) ? update_obj["$unset"] = unset_obj : null;

                    var filter = {_id};
                    // (isRemarks)?null:filter["userId"] = userId;
                    console.log("Filter",JSON.stringify(filter),"Object:",JSON.stringify(update_obj));
                    docs = yield dispatchCollection.updateOne(filter, update_obj);
                    
                    bucket.getFiles({ prefix: `attachments/${_id}`}, function(error, files) {
                        if(error){
                            console.log("Error getting files:",JSON.stringify(error));
                        }
                        for (var i in files) {
                            var isExists = ATTACHMENTS.find(x => { return x.storageFilename == files[i].name; });
                            (isExists) ? null : files[i].delete();
                        }

                        if(ATTACHMENTS.length > 0){
                            var totalAttachments = ATTACHMENTS.length,
                                uploadedAttachments = 0;
                            ATTACHMENTS.forEach(function(val){
                                if(val.base64){
                                    uploadAttachments(val.base64,val.storageFilename).then(() => {
                                        isProcessDone();
                                    }).catch(error => {
                                        console.log("Error Uploading: ",JSON.stringify(error));
                                        closeConnection(docs);
                                    });
                                } else {
                                    isProcessDone();
                                }
                                function isProcessDone(){
                                    uploadedAttachments++;
                                    if(totalAttachments == uploadedAttachments){
                                        closeConnection(docs);
                                    }
                                }
                            });
                        } else {
                            closeConnection(docs);
                        }
                    });
                }
            } else if(method === "DELETE"){
                if(parameterComplete(null,params_value)) {
                    var _id = params_value[1];
                    if(isEmpty([userId,_id]) === true){
                        res.status(400).send('Error: Missing parameters');
                    } else {
                        initializeStorage();
                        var docs = yield dispatchCollection.deleteOne({userId,_id});
                        bucket.getFiles({ prefix: `attachments/${_id}`}, function(error, files) {
                            console.log("Error deleting object:",JSON.stringify(error));
                            for (var i in files) {
                              files[i].delete();
                            }
                            closeConnection(docs);
                        });
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
        } else {
            res.status(200).send({
                "error": "Unauthorized"
            });
        }
    }).catch(function(error) {
        console.log(error);
        res.status(500).send('Error: ' + JSON.stringify(error));
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
    function initializeStorage(){
        // Creates a client
        storage = new Storage({
            credentials: {
                "type": "service_account",
                "project_id": "secure-unison-275408",
                "private_key_id": "fe24c3779352313011bff7eb38404083422951e0",
                "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDB0udJE9SZZELg\nM37jkC//mjgu7q1QAEBZ2XRhSdn1DPBYSGgPIWBoYWVdTVgwNxL/9eNowu6oOG/4\nFDuOZBXFBkZmoXIVyYzUA/GaWxW/ikieJ+9woSap8Sre71uZhv1x7235ljHhL7m7\nBTAfX6kxU8Rs8JC5Knn9hW3I4bXuZa4L+uBc5oaT7eRByscMjseXVilwZARDuR4f\nMk7rLvI6d8lY9fIJ/la5SWYdsjKUAQ+w6EhJ+fnH+ufi3rEt7aDOo2xxXhYwMWuS\njHF+LJNOV0vR5wp9h6yw/+ySoT2nL38mQMwEZv/k6405uTxt7Sak1vcUK8EGb8fo\nPYtBwiaRAgMBAAECggEACwML6RLjb4fqz8OajYcYibBYnvv9pJpbDZpv764V4BkJ\nLQQyG01KuwDGP501vzQwfr0uMM/Fu5DMoGl/3Q4SeY7qyt5tyvntknHF6n6LIgZ9\n1onPeKnt4SuxQ0NnRCCkqhzlCzrYCyKebgHJszfzYXjQTl3YOcOayjH9joiaVkNf\nBGjoYdJNEM6nVkK1mFeZRNQiUjSlHOYnbTwyzAqIXN0Y73kl4Y1I3CCozAtgevw7\nZApl1idf5pnOXb8qMr06RhWOIkpl0VSXRqRnOYqD2Rq7jKUVBYO33F+49G0josQ8\nIQZgeWlm5ENh03DmDzn6YXSUouchpTLAAl70IkzNdQKBgQD26Ia0I5lqBdkdzdtX\nz2thILzXQLwONCZRSkeIdjvkTSfKvi5fdy7HjA2iUZWgOQW4A4mkOvWJHpcdB0ac\nFmXctuz52+RfLvGjvBMNKN62qTN666WbFU8FOft7YMcqkhZHWkrbdJue4uVQFcVO\npMkp7hjFrdcwSBTh0+w2+MxttQKBgQDI9fpoDAl4lhlNlVow27BiXyYkWA0rDMyY\nGt8YpbUwJpZcZzhCTnsT/KbTaFxFR7XYrOuOFRxIU+FCZngqx2n+nYIlJ41/Q5d1\nKA5FUr/elbvDa6zegFTunniBS74lCKDn0WFimV8JO2RrhvdWfslFMOAvf6jExInm\nmpjPaWv+7QKBgQCRFM7aGLTzvJ34SlbhgQq6ls7/uJUHz5LYX0orIDZPDxsboaaE\nB/cf3+a/Aytlazw2BTYin1ZZjPUEZJsT6oFOMNqMcq39VAs+x6t2Jxa+xCtwxfiY\naOv2yTxBIfvFwvN+V8r2qs0qjm5qIXC/pkph7fr2ZRC12RUUIT+Cia0tpQKBgDKa\ntlazCUODUJXX0SFSgOUUnq8yOQapL2/x/FHhkHGyldRo7aLMznNnAL9lnS6Y8zK/\nwIVDzZ5s+OFWmlXzZz6FfTtL7Xapl58Z2hYc01IClIiOObbBzCFWaHPuldAPjy0w\n7Xv9sQ/LE+t7zhbK0HYK67kqRV5fO3aFYYuBOX+1AoGAH1ST7XsF2prwf24kwtWh\n1BLna2TlhJ6R7odf+q5Pj9kt2BD7o88GJ9Mxgrv1pSyOD1AVNi1xrgm8ueDhba/E\ngoFo4OvHN5uVrselHggSL/47VQJ4QJJMENeJXYBMqmVa4ubXlunq64e0gfM1pXjv\ncu9GYEIJI+0ftrWxnyBZinA=\n-----END PRIVATE KEY-----\n",
                "client_email": "cloudstorage@secure-unison-275408.iam.gserviceaccount.com",
                "client_id": "101797234938420754889",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/cloudstorage%40secure-unison-275408.iam.gserviceaccount.com"
            },
            projectId:"secure-unison-275408"
        });
        bucket = storage.bucket('wru-dispatch2');
    }
    function uploadAttachments(base64,destination){
        return new Promise((resolve,reject) => {
            const fileDataDecoded = Buffer.from(base64, 'base64');
            
            var filename_for_storage = destination.split("/");
            filename_for_storage = filename_for_storage[filename_for_storage.length-1];

            const filepath = `/tmp/${filename_for_storage}`;
    
            fs.writeFile(filepath, fileDataDecoded, function(error) {
                //Handle Error
                if(error){
                    console.log("Error Write File: ",JSON.stringify(error));
                    reject(error);
                } else {
                    bucket.upload(filepath, { destination }, function (error, file) {
                        if (!error) {
                            resolve();
                        } else {
                            console.log("err",JSON.stringify(error));  // an error occurred
                            reject(error);
                        }
                    });
                }
            });
        });
    }
};