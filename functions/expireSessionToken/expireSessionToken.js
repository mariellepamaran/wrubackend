/**
 * expireSessionToken
 * 
 * >> Expire users' sessions when conditions are met <<
 * 
 * Clients have the option to choose between:
 *     > Expire session when expiry date has been reached (30 days from login date)  -- DEFAULT OPTION
 *     > Expire session when user has been inactive for more than X hours
 * Note that these^ are discussed with Vincent Sorreta. 
 * If client did not specify any expire option, use the default option.
 * 
 */

const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const request = require('request');

// database url (production)
const uri = "mongodb://wru:7t0R3DyO9JGtlQRe@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.expireSessionToken = (req, res) => {
    // set the response HTTP header2
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    // call the development version of this function
    try { request({ method: 'GET', url: `https://asia-east2-secure-unison-275408.cloudfunctions.net/expireSessionTokenxDev` }); } 
    catch (error){ console.log("Request Error",error); }

    co(function*() {
        
        /************** Variable Initialization **************/
        // initialize timezone and date formats
        const timezone = "Asia/Manila";
        const now = moment.tz(undefined, undefined, timezone); // get current time

        // initialize mongoDb Client
        const client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true });
        
        // list of clients. Key is usually the db name
        const CLIENTS = {
            "wd-coket1": null,
            "wd-coket2": null,
            "wd-fleet":  null,
            "wd-wilcon": null,

            "wm-wilcon": null,
        };
        const CLIENT_OPTIONS = {
            "wd-coket1": { type: "asHours", value: 2 },
            "wd-coket2": { type: "asHours", value: 2 },
            "wd-fleet":  { type: "asHours", value: 2 },
            "wd-wilcon": { expiry: true },

            "wm-wilcon": { expiry: true },
        };

        // array of promises
        const childPromise = [];

        var hasError = false; // check if there were error/s during process(). 
                              // the reason for this is to send status 500 after all CLIENTS are done 
                              // instead of returning error immediately while other CLIENTS (if available) 
                              // have not yet undergone through process().
        /************** end Variable Initialization **************/
    
            
        /************** Functions **************/
        function process(clientName){
            // initialize database
            const db = client.db(clientName);
            const sessionsCollection = db.collection('sessions');
            const sessionsActiveCollection = db.collection('sessions_active'); // used to save the last time user's mouse pointer moved in the website
            const tempSessionsCollection = db.collection('temp_sessions'); // used in window/tab closure
            const userLoginActivityCollection = db.collection('user_login_activity'); // used in Login Report
                
            // get client's custom logout options
            const expiry = CLIENT_OPTIONS[clientName].expiry;
            const type   = CLIENT_OPTIONS[clientName].type;
            const value  = CLIENT_OPTIONS[clientName].value;

            // if option is by Expiry, this function call will expire session token once 
            // today is greater than the session's expiry date
            if(expiry){
                sessionsCollection.find({
                    expiry: { $lt: now.toISOString() }
                }).toArray().then(docs => {
                    if(docs.length > 0){
                        
                        // store here the IDs of sessions that should be expired
                        const _ids = [];

                        docs.forEach(doc => {
                            // set default value to fields so they're not null or undefined
                            const metadata = (doc.device_info||{}).metadata || {};
                                    
                            // Username | Name | Date | IP Address | Activity | Duration
                            const set = {
                                username: doc.username,
                                login_date: doc.timestamp,
                                logout_date: now.toISOString(),
                                location: `${metadata.city||""}, ${metadata.region||""}, ${metadata.country||""}`,
                                ip: metadata.ip,
                            };

                            // add _id to  array
                            _ids.push(doc._id);

                            // add promise to array
                            // Note: 'userLoginActivityCollection' is used for Login Report
                            childPromise.push( userLoginActivityCollection.updateOne({ _id: doc._id },{ $set: set },{ upsert: true }) );
                        });

                        if(_ids.length > 0){
                            // delete all 'session-related' data linked to the session
                            childPromise.push( sessionsCollection.deleteMany({ _id: { $in: _ids } }) );
                            childPromise.push( sessionsActiveCollection.deleteMany({ _id: { $in: _ids } }) );
                            childPromise.push( tempSessionsCollection.deleteMany({ _id: { $in: _ids } }) );
        
                            Promise.all(childPromise).then(() => {
                                isDone(clientName);
                            }).catch(error => {
                                isDone(clientName,"Promise (Expiry)",error);
                            });
                        } else {
                            isDone(clientName);
                        }
                    } else {
                        isDone(clientName);
                    }
                });
            } 

            // the options is by 'asHours'
            else {
                // store session IDs that should be checked and deleted
                const getSessionsIds = [];
                // store here the appropriate logout time for the session
                const sessionLogoutTime = {};

                function deleteSession(){
                    if(getSessionsIds.length > 0){
                        function promiseAll(_ids){
                            // merge '_ids' and 'getSessionsIds' arrays                     >>> Array [1,2,1,2,1]
                            const merged = _ids.concat(getSessionsIds);
                            // convert Array to Set to remove duplicate values in array     >>> Set [1,2]
                            const removed_dups = new Set(merged);
                            // convert Set back to Array                                    >>> Array [1,2]
                            const sessionIds = Array.from(removed_dups);

                            // delete all 'session-related' data linked to the session
                            childPromise.push( sessionsCollection.deleteMany({ _id: { $in: sessionIds } }) );
                            childPromise.push( sessionsActiveCollection.deleteMany({ _id: { $in: sessionIds } }) );
                            childPromise.push( tempSessionsCollection.deleteMany({ _id: { $in: sessionIds } }) );
        
                            Promise.all(childPromise).then(() => {
                                console.log("# of _ids expired:",sessionIds.length);
                                isDone(clientName);
                            }).catch(error => {
                                isDone(clientName,"Promise (as Hours???)",error);
                            });
                        }

                        // retrieve all sessions in 'getSessionsIds'
                        sessionsCollection.find({ _id: { $in: getSessionsIds } }).toArray().then(docs => {
                            if(docs.length > 0){
                                const _ids = [];
                                docs.forEach(doc => {
                                    // set default value to fields so they're not null or undefined
                                    const metadata = (doc.device_info||{}).metadata || {};
                                    
                                    // Username | Name | Date | IP Address | Activity | Duration
                                    const set = {
                                        username: doc.username,
                                        login_date: doc.timestamp,
                                        logout_date: sessionLogoutTime[doc._id],
                                        location: `${metadata.city||""}, ${metadata.region||""}, ${metadata.country||""}`,
                                        ip: metadata.ip,
                                    };
    
                                    // add _id to  array
                                    _ids.push(doc._id);

                                    // add promise to array
                                    // Note: 'userLoginActivityCollection' is used for Login Report
                                    childPromise.push( userLoginActivityCollection.updateOne({ _id: doc._id },{ $set: set },{ upsert: true }) );
                                });
                                promiseAll(_ids);
                            } else {
                                promiseAll([]);
                            }
                        });
                    } else {
                        isDone(clientName);
                    }
                }
                function getSessionActiveData(){
                    // retrieve all sessions_active data
                    // this session is saved or updated every 30 seconds. The 'last_active_timestamp' is based on 
                    // the last time the user moved their mouse pointer on the WRU website
                    sessionsActiveCollection.find({}).toArray().then(docs => {
                        if(docs.length > 0){
                            docs.forEach(doc => {
                                // convert 'last_active_timestamp' to moment object
                                const startTime = moment.tz(doc.last_active_timestamp, undefined, timezone);
                                // get duration
                                const duration = moment.duration(now.diff(startTime));
    
                                // if duration is more than the client's custom logout hour value
                                if(duration[type]() >= value){
                                    getSessionsIds.push(doc._id);

                                    // make 'last_active_timestamp' as logout time
                                    sessionLogoutTime[doc._id] = startTime.toISOString();
                                }
                            });
                        }
                        deleteSession();
                    });
                }
                
                // retrieve all tempSessions data
                // temporary sessions are saved when a user closed the browser tab or window
                // Note that not all clients have this king of feature.
                tempSessionsCollection.find({}).toArray().then(docs => {
                    if(docs.length > 0){
                        docs.forEach(doc => {
                            // convert 'last_active_timestamp' to moment object
                            const startTime = moment.tz(doc.last_active_timestamp, undefined, timezone);
                            // get duration
                            const duration = moment.duration(now.diff(startTime));

                            // if duration is more than 5 minutes
                            if(duration.asMinutes() >= 5){
                                getSessionsIds.push(doc._id);

                                // make 'last_active_timestamp' as logout time
                                sessionLogoutTime[doc._id] = startTime.toISOString();
                            }
                        });
                    }
                    getSessionActiveData();
                });
            }    
        }

        // will resolve the function depending if there was an error or not. Also, this will display the error if an error is passed
        // check if all CLIENTS[] are done
        function isDone(clientName,errTitle,err){ 
        
            // if error, display the title and error
            if(err) {
                console.log(`Error in ${errTitle}:`,err);
                hasError = true;
            }

            // when process() is done per client, changed value to true for checking later
            CLIENTS[clientName] = true;

            var allClientsAreDone = true;

            // check if all CLIENTS[] is equal to true
            Object.keys(CLIENTS).forEach(key => {
                if(CLIENTS[key] !== true) allClientsAreDone = false;
            });

            // if all clients are done, close mongodb client and resolve function
            if(allClientsAreDone === true){
                // close the mongodb client connection
                client.close();
                
                // return 
                res.status(hasError?500:200).send(hasError?"ERROR":"OK");
            }
        }
        /************** end Functions **************/


        /************** START OF PROCESS **************/
        // execute process() function for each CLIENTS element
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};