const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');

// PRODUCTION
// const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";
// DEVELOPMENT
const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-dev-shard-00-00.tyysb.mongodb.net:27017,wru-dev-shard-00-01.tyysb.mongodb.net:27017,wru-dev-shard-00-02.tyysb.mongodb.net:27017/wru-dev?ssl=true&replicaSet=atlas-5ae98n-shard-0&authSource=admin&retryWrites=true&w=majority"

exports.expireSessionTokenDev = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            childPromise = [],
            CLIENTS = {
                "wd-coket1":null,
                "wd-coket2":null,
                "wd-fleet":null,
                "wd-wilcon":null,

                "wm-wilcon":null,
            },
            customLogoutOptions = {
                "wd-coket1": { type: "asHours", value: 2 },
                "wd-coket2": { type: "asHours", value: 2 },
                "wd-fleet": { type: "asHours", value: 2 },
                "wd-wilcon": { expiry: true },

                "wm-wilcon": { expiry: true },
            },
            date = moment(new Date()).toISOString(),
            process = function(clientName){
                const db = client.db(clientName),
                    sessionsCollection = db.collection('sessions'),
                    sessionsActiveCollection = db.collection('sessions_active'),
                    tempSessionsCollection = db.collection('temp_sessions'), // used in window/tab closure
                    userLoginActivityCollection = db.collection('user_login_activity');
                    
                var expiry = customLogoutOptions[clientName].expiry;
                var type = customLogoutOptions[clientName].type;
                var value = customLogoutOptions[clientName].value;

                if(expiry){
                    sessionsCollection.find({
                        expiry: { $lt: date }
                    }).toArray().then(docs => {
                        if(docs.length > 0){
                            var _ids = [];
                            docs.forEach(doc => {
                                doc.device_info = doc.device_info || {};
                                doc.device_info.metadata = doc.device_info.metadata || {};
                                var metadata = doc.device_info.metadata;
                                // Username | Name | Date | IP Address | Activity | Duration
                                var data = {
                                    username: doc.username,
                                    login_date: doc.timestamp,
                                    logout_date: date,
                                    location: `${metadata.city||""}, ${metadata.region||""}, ${metadata.country||""}`,
                                    ip: metadata.ip,
                                };

                                _ids.push(doc._id);
                                childPromise.push( userLoginActivityCollection.updateOne({_id: doc._id},{$set: data},{upsert: true}) );
                            });
    
                            if(_ids.length > 0){
                                childPromise.push( sessionsCollection.deleteMany({ _id: { $in: _ids } }) );
                                childPromise.push( sessionsActiveCollection.deleteMany({ _id: { $in: _ids } }) );
                                childPromise.push( tempSessionsCollection.deleteMany({ _id: { $in: _ids } }) );
            
                                Promise.all(childPromise).then(() => {
                                    areClientsDone(clientName);
                                }).catch(error => {
                                    console.log(JSON.stringify(error));
                                    client.close();
                                    res.status(500).send('Error in Promise All: ' + JSON.stringify(error));
                                });
                            } else {
                                areClientsDone(clientName);
                            }
                        } else {
                            areClientsDone(clientName);
                        }
                    });
                } else {
                    var getSessionsIds = [];
                    var sessionLogoutTime = {};
                    function deleteSession(){
                        if(getSessionsIds.length > 0){
                            function promiseAll(_ids){
                                var mergedIds = _ids.concat(getSessionsIds);
                                var allIdsArr = new Set(mergedIds);
                                var allIds = Array.from(allIdsArr);
                                childPromise.push( sessionsCollection.deleteMany({ _id: { $in: allIds } }) );
                                childPromise.push( sessionsActiveCollection.deleteMany({ _id: { $in: allIds } }) );
                                childPromise.push( tempSessionsCollection.deleteMany({ _id: { $in: allIds } }) );
            
                                Promise.all(childPromise).then(() => {
                                    console.log("# of _ids expired:",allIds.length);
                                    areClientsDone(clientName);
                                }).catch(error => {
                                    console.log(JSON.stringify(error));
                                    client.close();
                                    res.status(500).send('Error in Promise All: ' + JSON.stringify(error));
                                });
                            }
                            sessionsCollection.find({ _id: { $in: getSessionsIds } }).toArray().then(docs => {
                                if(docs.length > 0){
                                    var _ids = [];
                                    docs.forEach(doc => {
                                        doc.device_info = doc.device_info || {};
                                        doc.device_info.metadata = doc.device_info.metadata || {};
                                        var metadata = doc.device_info.metadata;
                                        // Username | Name | Date | IP Address | Activity | Duration
                                        var data = {
                                            username: doc.username,
                                            login_date: doc.timestamp,
                                            logout_date: sessionLogoutTime[doc._id],
                                            location: `${metadata.city||""}, ${metadata.region||""}, ${metadata.country||""}`,
                                            ip: metadata.ip,
                                        };
        
                                        _ids.push(doc._id);
                                        childPromise.push( userLoginActivityCollection.updateOne({_id: doc._id},{$set: data},{upsert: true}) );
                                    });
                                    promiseAll(_ids);
                                } else {
                                    promiseAll([]);
                                }
                            });
                        } else {
                            areClientsDone(clientName);
                        }
                    }
                    function getTempSessionsData(){
                        tempSessionsCollection.find({}).toArray().then(docs => {
                            if(docs.length > 0){
                                docs.forEach(doc => {
                                    var end = moment();
                                    var startTime = moment(new Date(doc.last_active_timestamp));
                                    var duration = moment.duration(end.diff(startTime));
        
                                    if(duration.asMinutes() >= 5){
                                        getSessionsIds.push(doc._id);
                                        sessionLogoutTime[doc._id] = moment(new Date(doc.last_active_timestamp)).toISOString();
                                    }
                                });
                            }
                            getSessionActiveData();
                        });
                    }
                    function getSessionActiveData(){
                        sessionsActiveCollection.find({}).toArray().then(docs => {
                            if(docs.length > 0){
                                docs.forEach(doc => {
                                    var end = moment();
                                    var startTime = moment(new Date(doc.last_active_timestamp));
                                    var duration = moment.duration(end.diff(startTime));
        
                                    if(duration[type]() >= value){
                                        getSessionsIds.push(doc._id);
                                        sessionLogoutTime[doc._id] = moment(new Date(doc.last_active_timestamp)).toISOString();
                                    }
                                });
                            }
                            deleteSession();
                        });
                    }
                    getTempSessionsData();
                }    
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
        console.log("Error"+JSON.stringify(error),error.toString());
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};