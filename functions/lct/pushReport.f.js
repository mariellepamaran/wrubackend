/**
 * pushReportToLCT
 * 
 * >> Check email and get attachments. Send it to LCT <<
 * 
 * 
 */

const functions = require('firebase-functions');
const request = require('request')
const co = require('co');
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
let messageIds = []
// Tips: Logout of all gmail accounts then sign in to the account you want to use for email.
// https://www.google.com/settings/security/lesssecureapps

exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {

        /************** Functions **************/
        function connectToImap(){

            // reference: https://www.npmjs.com/package/imap-simple

            // connect imap
            imaps.connect(config).then(function (connection) {

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
                                            // if (properties[j].includes(",")) {
                                            // obj[headers[j]] = properties[j]
                                            //     .split(",").map(item => item.trim())
                                            // }
                                            // else obj[headers[j]] = properties[j]
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

                    
                    // console.log(JSON.stringify(attachments));

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

                    csvAttachments.forEach(csv => {
                        loopAndSend(csv)
                    })

                    function loopAndSend(csv) {

                        var failed = []
                        var success = []
                        csv.data.forEach((obj, objIndex, objsArray) => {
                            var options = {
                                'method': 'GET',
                                'headers': {
                                  'Content-Type': 'text/plain'
                                },
                                timeout: 120000,
                                body: JSON.stringify(obj)
                            };

                            try {
                                request('http://168.63.233.236/wru/api_wru_save_ggs.aspx',options, function (error, response, body) {
                                // console.log("---------------------")
                                if (!error && body) {
                
                                    var parsed
                
                                    try {
                                        parsed = JSON.parse(body)
                                        // console.log(JSON.stringify(parsed))
                                        if(parsed && parsed.RESULT == 'SAVED') {
                                            console.log(JSON.stringify(parsed))
                                            success.push(obj)
                                            // resolve()
                                        } else {
                                            console.log(`else`)
                                            failed.push(obj)

                                            // reject()
                                        }
                                    } catch (error) {
                                        failed.push(obj)
                                        // console.error(error);
                                        // reject(error)
                                    }
                
                                } else {
                                    console.error(JSON.stringify(error))
                                    failed.push(obj)
                                    // reject()
                                }

                                if((failed.length + success.length) == objsArray.length) {
                                    console.log('ALL REQUESTED')
                                    if (failed.length != 0) {
                                        resendCSV({ data: failed })
                                    } else {
                                        console.log('ALL SENT')
                                        markEmailRead()
                                    }
                                } else {
                                    console.log(`${failed.length + success.length}/${objsArray.length}`)
                                }
                            });
                        } catch (error) {
                            console.error(JSON.stringify(error))
                            failed.push(obj)
                        }
                    });
                    }

                    function resendCSV(csv) {
                        console.log(`Resending ${csv.data.length} object(s)`)
                        loopAndSend(csv)
                    }

                    function markEmailRead() {
                        imaps.connect(config).then(function (connection) {

                            connection.openBox('INBOX').then(function () {

                                messageIds.forEach(id => {
                                    connection.addFlags(id, ['\\Seen'], function (err) {
                                        if (err) {
                                            console.log(err);
                                        } else {
                                            console.log("Marked as read!")
                                        }
                                    });
                                })

                            });
                        })
                    }

                    res.json({
                        ok:1, 
                        attachments: attachments.length != 0 ? `${csvAttachments.length} CSV File(s) is now being sent.` : 'No report to be sent.'
                    });
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