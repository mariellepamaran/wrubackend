const co = require('co');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

exports.ping = (req, res) => {
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        var CLIENTS = {
                "wd-coket1-dev": null,
                "wd-wilcon-dev": null,
                "wm-wilcon-dev": null,

                "wd-coket1-prod": null,
                "wd-wilcon-prod": null,
                "wm-wilcon-prod": null,
            },
            CLIENT_INFO = {
                "wd-coket1-dev": "https://wrudispatch-dev.azurewebsites.net/CokeT1",
                "wd-wilcon-dev": "https://wrudispatch-dev.azurewebsites.net/Wilcon",
                "wm-wilcon-dev": "https://wrumaintenance-dev.azurewebsites.net/Wilcon",

                "wd-coket1-prod": "https://wrudispatch.azurewebsites.net/CokeT1",
                "wd-wilcon-prod": "https://wrudispatch.azurewebsites.net/Wilcon",
                "wm-wilcon-prod": "https://wrumaintenance.azurewebsites.net/Wilcon",
            },
            process = function(clientName){
                function ping(host, port, pong) {
                    var started = new Date().getTime();
                    var http = new XMLHttpRequest();
                    
                    port = port ? ":" + port : "";

                    http.open("GET", "http://" + host + port, /*async*/true);
                    http.onreadystatechange = function() {
                        if (http.readyState == 4) {
                            var ended = new Date().getTime();
                            var milliseconds = ended - started;
                        
                            if (pong != null) { pong(milliseconds); }
                        }
                    };
                    try {
                        http.send(null);
                    } catch(exception) {
                        // this is expected
                    }
                }
                
                ping(CLIENT_INFO[clientName], null, function(m){ console.log(CLIENT_INFO[clientName],": It took "+m+" miliseconds."); areClientsDone(clientName); })
            },
            areClientsDone = function(clientName){
                CLIENTS[clientName] = true;
                var done = true;
                Object.keys(CLIENTS).forEach(key => {
                    if(CLIENTS[key] !== true) done = false;
                });
                if(done === true){
                    res.status(200).send("OK");
                }
            };

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