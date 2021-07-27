const co = require('co');
const mongodb = require('mongodb');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const { readFile, writeFile } = require('fs').promises;
const transporter = nodemailer.createTransport({
    host: "mail.wru.ph",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: "dispatch@wru.ph",
        pass: "cNS_PMJw7FNz",
    },
});

const uri = "mongodb://marielle:gwt2sqiMDZ5JnBM@wru-shard-00-00.tyysb.mongodb.net:27017,wru-shard-00-01.tyysb.mongodb.net:27017,wru-shard-00-02.tyysb.mongodb.net:27017/wru?ssl=true&replicaSet=atlas-d1iq8u-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.vehicleAutomatedEmail = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var client = yield mongodb.MongoClient.connect(uri,{ useUnifiedTopology: true }),
            CLIENTS = {
                  "wd-coket1":null,
                  "wd-coket2":null,
            },
            CLIENT_NAME = {
                "wd-coket1": "CokeT1",
                "wd-coket2": "CokeT2",
            },
            date = moment(new Date()).format("MM/DD/YYYY"),
            date1 = moment(new Date()).format("MM_DD_YYYY"),
            process = function(clientName){
                const db = client.db(clientName),
                    vehiclesCollection = db.collection('vehicles');

                const outputFileName = `${CLIENT_NAME[clientName]}_Truck_Data_${date1}.csv`;
                const outputFilePath = `/tmp/${outputFileName}`;

                vehiclesCollection.find({}).toArray().then(docs => {
                    const data = [];
                    docs.forEach(val => {
                        data.push({
                            "Truck": val["name"] || "",
                            "Trailer": val["Trailer"] || "",
                            "Equipment Number": val["Equipment Number"] || "",
                            "Tractor Conduction": val["Tractor Conduction"] || "",
                            "Availability": val["Availability"] || "",
                        });
                    });
                    (async () => {
                        const escapeToken = '~~~~';
                        const escapedData = escapeCommas(data, escapeToken);
                        const escapedCSV = arrayToCSV(escapedData);
                        const CSV = unescapeCommas(escapedCSV,escapeToken);
                        await writeCSV(outputFilePath, CSV);
                        console.log(`Successfully converted ${outputFileName}!`);
                
                        transporter.sendMail({
                            from: '"WRU Corporation" <noreply@wru.ph>', // sender address
                            cc: ["lct.automation@coca-cola.com.ph","teng@wru.ph"], // list of receivers
                            // cc: ["mariellepamaran@gmail.com","mariellepamaran@yahoo.com","marielle@wru.ph"], // list of receivers
                            subject: `${CLIENT_NAME[clientName]} Truck Data - ${date}`,
                            text: "",
                            html: "",
                            attachments: [{ filename: outputFileName, path: outputFilePath  }], //  __dirname + '/pdf/test.pdf'
                        }, function(error, info){
                            var message = (error) ? "Error sending the email." : "Email successfully sent!";
                            console.log(clientName,message);
                            areClientsDone(clientName);
                        }); 
                    })();
                }).catch(error => {
                    console.log("Error IL",error);
                    res.status(500).send('Error IL: ' + JSON.stringify(error));
                });
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

        /*********** ARRAY TO CSV ***********/
        /* var data = [  { a:"1", b:"2" }, { a:"3", b:"4" }, { a:"5", b:"6,7" } ]; */
        function escapeCommas (data, token) {
            return data.map(row => {
                var obj = {};
                Object.keys(row).forEach(key => { obj[key] = row[key].replace(/,/g, token); });
                return obj;
            });
        }
        
        function unescapeCommas (data, token) {
            data.replace(/~~~~/g,",")
            return data.replace(new RegExp(`${token}`, 'g'), ',');
        }

        function arrayToCSV (data) {
            csv = data.map(row => Object.values(row));
            csv.unshift(Object.keys(data[0]));
            return `"${csv.join('"\n"').replace(/,/g, '","')}"`;
        }

        async function writeCSV (fileName, data) {
            await writeFile(fileName, data, 'utf8');
        }
        /*********** END ARRAY TO CSV ***********/


        /************** START OF PROCESS **************/
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        console.log("Error",error);
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};