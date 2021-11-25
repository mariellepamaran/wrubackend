/**
 * test_receiver
 * 
 * >> An API to just receive data and display the data it recieved <<
 * 
 */

const functions = require('firebase-functions');
const co = require('co');
 
exports = module.exports = functions.region('asia-east2').runWith({ timeoutSeconds: 60, memory: '128MB' }).https.onRequest((req, res) => {

    co(function*() {       

        // successful. Return successful and data received
        res.status(200).send({
            ok: 1,
            Method: req.method,
            Body: req.body,
            Query: req.query,
            Params: req.params,
        });

    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
});