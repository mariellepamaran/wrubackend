/**
 * test_receiver
 * 
 * >> An API to just receive data and display the data it recieved <<
 * 
 */

 const co = require('co');
 
 // named "truck" so that we can differentiate from vehicles function
 exports.test_receiver = (req, res) => {
     // set the response HTTP header
     res.set('Content-Type','application/json');
     res.set('Access-Control-Allow-Origin', '*');
     res.set('Access-Control-Allow-Headers', '*');
     res.set('Access-Control-Allow-Methods', 'GET');
 
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
 };