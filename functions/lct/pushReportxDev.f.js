/**
 * pushReportToLCT
 * 
 * >> Check email and get attachments. Send it to LCT <<
 * 
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
const request = require('request');
const imaps = require('imap-simple');
const config = {
    imap: {
        user: 'wru.developer@gmail.com',
        password: 'IamWRUCorp',
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 30000,
        tlsOptions: { 
            rejectUnauthorized: false
        }
    }
};
const batchOf = 10;

// Tips: Logout of all gmail accounts then sign in to the account you want to use for email.
// https://www.google.com/settings/security/lesssecureapps
                                                                                // 5 min
exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 300, memory: '256MB' }).https.onRequest((req, res) => { 

    co(function*() {

        /************** Functions **************/
        function connectToImap(){

            // reference: https://www.npmjs.com/package/imap-simple

            // connect imap
            imaps.connect(config).then(function (connection) {

                const messageIds = [];

                // open inbox
                connection.openBox('INBOX').then(function () {
            
                    // Fetch emails today

                    var today = new Date();
                    today.setHours(0,0,0,0)
                    today = today.toISOString();

                    const searchCriteria = ['UNSEEN', ['SINCE', today]];
                    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true };
            
                    // retrieve only the headers of the messages
                    return connection.search(searchCriteria, fetchOptions);
                }).then(function (messages) {
            
                    var attachments = [];
            
                    // loop messages
                    messages.forEach(function (message) {
                        const parts = imaps.getParts(message.attributes.struct);
                        attachments = attachments.concat(parts.filter(function (part) {
                            return part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT';
                        }).map(function (part) {
                            // retrieve the attachments only of the messages with attachments
                            return connection.getPartData(message, part)
                                .then(function (partData) {
                                    // Original
                                    // <Buffer ef bb bf 54 69 74 6c 65 2c 44 65 73 63 72 69 70 74 69 6f 6e 0d 0a 54 65 73 74 2c 49 20 61 6d 20 61 20 74 65 73 74 0d 0a>
        
                                    // Convert buffer to utf-8 string
                                    // Output: 'Title,Description\r\nTest,I am a test\r\n'
                                    const csv = partData.toString('utf8');
        
                                    // Convert the data to String and
                                    // split it in an array
                                    var array = csv.split("\r\n");
                                    
                                    // All the rows of the CSV will be
                                    // converted to JSON objects which
                                    // will be added to result in an array
                                    let result = [];

                                    // define row indexes
                                    const headerRowIndex = 1; // Header is 2nd row
                                    const dataStartIndex = 2; // index of row to check data
                                    
                                    // The array[0] contains all the
                                    // header columns so we store them
                                    // in headers array
                                    let headers = array[headerRowIndex].split(",")
                                    
                                    // Since headers are separated, we
                                    // need to traverse remaining n-1 rows.
                                    for (let i = dataStartIndex; i < array.length - 1; i++) {
                                        let obj = {}
                                        
                                        // Create an empty object to later add
                                        // values of the current row to it
                                        // Declare string str as current array
                                        // value to change the delimiter and
                                        // store the generated string in a new
                                        // string s
                                        let str = array[i]
                                        let s = ''
                                        
                                        // By Default, we get the comma separated
                                        // values of a cell in quotes " " so we
                                        // use flag to keep track of quotes and
                                        // split the string accordingly
                                        // If we encounter opening quote (")
                                        // then we keep commas as it is otherwise
                                        // we replace them with pipe |
                                        // We keep adding the characters we
                                        // traverse to a String s
                                        let flag = 0
                                        for (let ch of str) {
                                            if (ch === '"' && flag === 0) {
                                            flag = 1
                                            }
                                            else if (ch === '"' && flag == 1) flag = 0
                                            if (ch === ',' && flag === 0) ch = '|'
                                            if (ch !== '"') s += ch
                                        }
                                        
                                        // Split the string using pipe delimiter |
                                        // and store the values in a properties array
                                        let properties = s.split("|")
                                        
                                        // For each header, if the value contains
                                        // multiple comma separated data, then we
                                        // store it in the form of array otherwise
                                        // directly the value is stored
                                        for (let j in headers) {
                                            obj[headers[j]] = properties[j]
                                        }
                                        
                                        // Add the generated object to our
                                        // result array


                                        if (obj.Vehicle) {
                                            const id = message.attributes.uid
                                            if (!messageIds.includes(id)) {
                                                messageIds.push(id)
                                            }
                                            // Add the generated object to our
                                            // result array
                                            result.push(obj)
                                        }
                                    }
        
                                    return {
                                        filename: ((part.disposition||{}).params||{}).filename || (part.params||{}).name,
                                        data: result
                                    };
                                }).catch(error => {
                                    console.log(error);
                                    res.json({error:1, message: error});
                                });
                        }));
                    });
            
                    return Promise.all(attachments);
                }).then(function (attachments) {
                    
                    const csvAttachments = [];

                    // check if file is CSV based on filename
                    attachments.forEach(val => {

                        // get file extension
                        const ext = (val.filename||"").split('.').pop().toLowerCase();

                        // check if CSV and push to array
                        if(ext == 'csv'){
                            csvAttachments.push(val);
                        }
                    });

                    const failed = {};
                    const success = {};

                    if(csvAttachments.length > 0){
                        // loop csv attachments
                        csvAttachments.forEach((csv,i) => {
                            loopAndSend(csv,i);
                        });
                    } else {
                        // return that no attachments was received
                        res.json({
                            ok: 1, 
                            attachments: 'No attachments received'
                        });
                    }

                    function promiseRequest( obj, objIndex, attachmentIndex ) {
                        return new Promise(resolve => {
                            
                            success[attachmentIndex] = success[attachmentIndex] || [];
                            failed[attachmentIndex] = failed[attachmentIndex] || [];

                            // Request data and options
                            const postData = JSON.stringify(obj);
                            const options = {
                                'method': 'POST',
                                'headers': {
                                    'Content-Type': 'text/plain',
                                    'Content-Length': postData.length,
                                    'Connection': 'keep-alive'
                                },
                                timeout: 120000,
                                body: postData
                            };

                            // generate random number for timeout
                            const maximum = 2;
                            const minimum = 0;
                            const randomNumber = (Math.random() * (maximum - minimum + 1) ) << 0;
                        
                            // requests should not be sent all at once.There should be time gaps between request (???)
                            setTimeout(function(){

                                // send request
                                request('http://168.63.233.236/wru/api_wru_save_ggs.aspx', options, function(err, response, body) {

                                    if(body){
                                        if(body.indexOf('SAVED') > -1){
                                            success[attachmentIndex].push(objIndex);

                                            // delete index from failed[index]
                                            failed[attachmentIndex] = failed[attachmentIndex].filter(x => x !== objIndex);
                                        } else {
                                            // 403 error
                                            failed[attachmentIndex].push(objIndex);
                                        }
                                    } else {
                                        // unknown request error
                                        failed[attachmentIndex].push(objIndex);
                                        console.log('Error',error);
                                    }
                                    resolve();
                                });
                            }, 100 * randomNumber); // 100ms * Random number
                        });
                    }

                    function loopAndSend( csv, attachmentIndex, _MIN=0, _MAX=batchOf ) {

                        const promises = [];

                        // send by batches (by 10)
                        function batchSend( MIN, MAX ){

                            for(var i = MIN; i < MAX; i++){
                                const obj = csv.data[i];
                                if(obj && ((failed[attachmentIndex]||[]).length == 0 || failed[attachmentIndex].includes(i))){
                                    promises.push(promiseRequest(obj,i,attachmentIndex));
                                }
                            }

                            if(promises.length > 0){
                                Promise.all(promises).then(result => {
        
                                    if((failed[attachmentIndex]||[]).length > 0){
                                        resendCSV(csv,attachmentIndex,MIN,MAX);
                                    } else {
                                        if(success[attachmentIndex].length == csv.data.length){
                                            markEmailRead();
                                        } else {
                                            if((MAX+batchOf) < csv.data.length){
                                                batchSend(MAX,MAX+batchOf);
                                            } else {
                                                batchSend(MAX,csv.data.length);
                                            }
                                        }
                                    }
                                });
                            } else {
                                if(success[attachmentIndex].length == csv.data.length){
                                    markEmailRead();
                                } else {
                                    if((MAX+batchOf) < csv.data.length){
                                        batchSend(MAX,MAX+batchOf);
                                    } else {
                                        batchSend(MAX,csv.data.length);
                                    }
                                }
                            }

                        }
                        batchSend(_MIN,_MAX);
                    }

                    function resendCSV(csv,index,MIN,MAX) {
                        console.log(`Resending ${failed[index].length} object(s)  |  Success ${success[index].length}/${csv.data.length}`);
                        loopAndSend(csv,index,MIN,MAX);
                    }

                    function markEmailRead() {
                        console.log('Marking email as read...');

                        imaps.connect(config).then(function (connection) {

                            connection.openBox('INBOX').then(function () {

                                messageIds.forEach(id => {
                                    connection.addFlags(id, ['\\Seen'], function (err) {
                                        if (err) {
                                            console.log(err);
                                        } else {
                                            console.log("Marked as read!");
                                        }

                                        const successLength = {};
                                        Object.keys(success).forEach(key => { successLength[key] = success[key].length; });

                                        const failedLength = {};
                                        Object.keys(failed).forEach(key => { failedLength[key] = failed[key].length; });

                                        res.json({
                                            ok: 1,
                                            failed: failedLength,
                                            success: successLength,
                                            attachments: attachments.length != 0 ? `${csvAttachments.length} CSV File(s) is now being sent.` : 'No report to be sent.'
                                        });
                                    });
                                })

                            });
                        })
                    }
                }).catch(error => {
                    console.log(error);
                    res.json({error:1, message: error});
                });
            }).catch(error => {
                console.log(error);
                res.json({error:1, message: error});
            });
        };
        /************** end Functions **************/

        connectToImap();
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});