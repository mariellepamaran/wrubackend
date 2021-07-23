exports.credentials = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    console.log("Authorization header: "+req.headers.authorization);
    if(req.headers.authorization === "395d8ef62b8a4de"){
        var data = {
            mongodb: {
                uri: "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority",
                appId: "wru_dispatch-wmhvm",
            },
            wru: {
                appId: 9,
            }
        };
        res.status(200).send(data);
    } else {
        res.status(200).send({
            "error": "Unauthorized"
        });
    }
};
// 395d8ef62b8a4de
// c64423 w5f6c9 drcaa5 26ua7d 711m98 4bd4ae 0cbf0f re7ee6 ai7c52 aae86b dc0848 e5a99a 3c05c4 30e7ld 94dlae
// c64423w5f6c9drcaa526ua7d711m984bd4ae0cbf0fre7ee6ai7c52aae86bdc0848e5a99a3c05c430e7ld94dlae