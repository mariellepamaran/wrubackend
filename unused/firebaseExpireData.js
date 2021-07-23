const co = require('co');
const admin = require("firebase-admin");
const moment = require('moment-timezone');

admin.initializeApp({
    credential: admin.credential.cert({
        "type": "service_account",
        "project_id": "secure-unison-275408",
        "private_key_id": "78ccc0517c35244969ed47e14cf9c1085d5b81f0",
        "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCi/leD/O78/PF7\nq7bnjaGa+AgS9LVHUgSwZTj8y67xfCDtdXfpWVaSUGQtCLyb6HkaQW31WZX6RuS9\nwryqtKSRRt9bPSx3Ld78PsnkVw802U8fj8SsONxmMZFHVUEyOnC+k26+7j2YEFMQ\nSX3Fc4Arq+W8Rgw3XQPQ5/yz/9SilJF3vU0iATprwoNwuE4OL+I4R9Uh/vDWWalr\nc0mNRZbPjy4dHhPbeVcH6J/G/iDzd0XZYmLAqzncqhjd3JaQNymZATqIb3yVJG2F\n1hBGV/OixbXMmvoE0I28GnP/SUurVWM6RjpKvCWsK+hKFQkB4ulmT4fIv8E0rFs9\ne+H/irI1AgMBAAECggEAFZlwZgKE9hwb8ShQeO9tIMDpKv/oLO8axXhofKGOSZyK\nLYWRUig/X2zNVaVwfxWnxLmydV69j/jIk7gEcfe1zjWu4COjapi20cUNUpfR4U5B\n3Lwb0znGxTkg2CvdU6dobOzTMnSWT3osU751bw7PB5qEO3ap5EVMfejcNUs79Z5V\nrq0WFQQh1FbmZ2Wm19rzBGOhLtpXMdRvEvRL/zQyL5vJ6NleftNG3bLRoyVjzrds\nDDBCL9QNw7qasIzN6zQ/TyeUvQKzK6GCB6PwXphn4vJ946AhyG/wLEv6JcT9gS/o\nWJpr4tvubWuSOanoISWQASLqADYFhOaz3Upvus2yyQKBgQDe/KSeqjlCGeMFDkAb\nlmuqlRcL4yUbdx1RzppQ7kN3kARDuBGz6FbDL6TODd8AQ8e5J9ADJJBjxSAmA/pH\n7ljD6bEx6bC57hae7sgAY1BxienGODYc4xhL7F+GyGLGIEueiSQZJ5z4ma2VgUIb\na4gb/4WTFEEzY6vWAF8GMEoXTQKBgQC7H+itlKAZfzlTLWqup2/UHP/wz7ygtroW\nHkFUEsfdNfplnJjJFpwkaGqhZ3CtUzeV180+HTErcun3ALhXG08UcRyz5Kx27mXM\nX/pocwfoG0AWsS9bwz84sFNPNA1Ie9aHbl4UGaDSb1pwMg9mFmljlKwTskaKfOAp\nY4MoZfwiiQKBgFuDM8wp7/XAyfp5LrYjtWv8Y8jtH312FQJN1+b+4ZFf+WARWrKK\n15CjLO+jobFqH71NKYEgsGFBtT/kwgJjPuqoLaBeV7j2jTIMrOf72je+ccJ3rz2L\ntZzzFQErm93TwzT882OfbjxYVXTV51t5dhKHezoxRdDhRtQ8ssLHbqDBAoGAW3q6\n/nkFV9Gpja9LUz0J35GZ0flMxujtyjhaSaawzMVBt4E59Dy4ctgVIPj3zdQ7/WY1\nsWMGEa6pEJbqh7MTEvRFSvDFG5NqcuKNAZkSyXbg+vb+JwcpliYlZDgXMlNQSn87\nQOpSg+3qMaVXf9n/Ba69/RcPg06PK8y5ZvuMqrkCgYEAwKVj/M8oW/xgpBmK48nn\nAaqEgJ7kRvOtNkNFNJ8bQ2weV8JdQLdgBC0zBN1EUM6Tdtz2Jv7EFVS3aJ3uUNMJ\nFVWFHn9u/inkqgNjYnAsehSR1R4eaxqSslxAVfxQtGPKXfGd1k279gKy80gIjyIx\nLwiHppxBi1JGOfhqYrVdlL8=\n-----END PRIVATE KEY-----\n",
        "client_email": "firebase-adminsdk-zjd8q@secure-unison-275408.iam.gserviceaccount.com",
        "client_id": "112187532314154122660",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-zjd8q%40secure-unison-275408.iam.gserviceaccount.com"
    }),
    databaseURL: "https://unison-275408.firebaseio.com"
});
var database = admin.database();

exports.firebaseExpireData = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        moment.tz.setDefault("Asia/Manila");

        var childPromise = [];
        database.ref().once("value", snapshot => {
            snapshot.forEach(collChild => {
                collChild.forEach(dataChild => {
                    var date = new Date(dataChild.val().timestamp);
                    date.setMinutes(date.getMinutes() + 15) // add 15 minutes
                    
                    // console.log(moment().valueOf(),moment(date).valueOf());
                    if(moment().valueOf() > moment(date).valueOf()){
                        childPromise.push(database.ref(`${collChild.key}/${dataChild.key}`).remove());
                    }
                });
            });
            Promise.all(childPromise).then(result => { 
                res.status(200).send("OK");
            }).catch(error => { 
                console.log("Error",error.toString()); 
                res.json(error); 
            });
        });
    }).catch(error => {
        console.log("Error"+JSON.stringify(error),error.toString());
        res.status(500).send('Error: ' + JSON.stringify(error));
    });
};