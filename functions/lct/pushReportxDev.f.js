/**
 * pushReportToLCT
 * 
 * >> Check email and get attachments. Send it to LCT <<
 * 
 * 
 */

const functions = require('firebase-functions');
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
            
                    // Fetch emails from the last 24h
                    const delay = 24 * 3600 * 1000;

                    var yesterday = new Date();
                        yesterday.setTime(Date.now() - delay);
                    yesterday = yesterday.toISOString();

                    const searchCriteria = ['UNSEEN', ['SINCE', yesterday]];
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
                                        result.push(obj)
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

                
                    /** #2 and #3 here */


                    res.json({
                        ok:1, 
                        attachments: csvAttachments 
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