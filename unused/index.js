const co = require('co');
const mongodb = require('mongodb');

const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";

exports.helloWorld = (req, res) => {
    co(function*() {
        const client = yield mongodb.MongoClient.connect(uri);

        const docs = yield client.db('wru').collection('test').find().toArray();
        res.send('Result: ' + JSON.stringify(docs));
    }).catch(error => {
        res.send('Error: ' + error.toString());
    });
};