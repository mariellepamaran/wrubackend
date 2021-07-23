const co = require('co');
const mongodb = require('mongodb');

var fs = require('fs');

// Imports the Google Cloud client library
const {Storage} = require('@google-cloud/storage');

exports.sessionToken2 = (req, res) => {
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
            params = req.params[0],
            params_value = params.split("/");
        // params_value.shift();

        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(`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`);
        const msg = {
          to: body.to,
          from: body.from,
          subject: body.subject,
          text: 'and easy to do anywhere, even with Node.js',
          html: '<strong>and easy to do anywhere, even with Node.js</strong>',
        };
        sgMail.send(msg).then(docs => {
          console.log(docs);
          res.status(200).send("OKAY");
        }).catch(error => {
          console.log(error);
          res.status(500).send("Error: "+error.toString());
        });
    }).catch(error => {
        console.log("Error",error);
        res.status(500).send('Error: ' + error.toString());
    });
};