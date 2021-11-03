/**
 * Ping
 * 
 * >> Ping WRU Azure websites so it is never idle <<
 * 
 */
const co = require('co');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

exports.ping = (req, res) => {
    // set the response HTTP header
    res.set('Content-Type','application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

    co(function*() {
        
        /************** Variable Initialization **************/
        // list of clients. Key is usually the db name
        const CLIENTS = {
            // WRU Dispatch
            // >> Dev
            "wd-coket1-dev": null,
            "wd-coket2-dev": null,
            "wd-fleet-dev": null,
            "wd-wilcon-dev": null,
            // >> Prod
            "wd-coket1-prod": null,
            "wd-coket2-prod": null,
            "wd-fleet-prod": null,
            "wd-wilcon-prod": null,

            // --------------------------------------------
            // WRU Maintenance
            // >> Dev
            "wm-wilcon-dev": null,
            // >> Prod
            "wm-wilcon-prod": null,
        };
        const CLIENT_INFO = {
            // WRU Dispatch
            // >> Dev
            "wd-coket1-dev": "https://wrudispatch-dev.azurewebsites.net/CokeT1",
            "wd-coket2-dev": "https://wrudispatch-dev.azurewebsites.net/CokeT2",
            "wd-fleet-dev": "https://wrudispatch-dev.azurewebsites.net/Fleet",
            "wd-wilcon-dev": "https://wrudispatch-dev.azurewebsites.net/Wilcon",
            // >> Prod
            "wd-coket1-prod": "https://wrudispatch.azurewebsites.net/CokeT1",
            "wd-coket2-prod": "https://wrudispatch.azurewebsites.net/CokeT2",
            "wd-fleet-prod": "https://wrudispatch.azurewebsites.net/Fleet",
            "wd-wilcon-prod": "https://wrudispatch.azurewebsites.net/Wilcon",

            // --------------------------------------------
            // WRU Maintenance
            // >> Dev
            "wm-wilcon-dev": "https://wrumaintenance-dev.azurewebsites.net/Wilcon",
            // >> Prod
            "wm-wilcon-prod": "https://wrumaintenance.azurewebsites.net/Wilcon",
        };
        /************** end Variable Initialization **************/

        
        /************** Functions **************/
        function process(clientName){

            // this function calls the website and returns how long it took to respond
            function ping(host, port, pong) {
                // get the time BEFORE calling the URL
                var started = new Date().getTime();
                var http = new XMLHttpRequest();
                
                port = port ? ":" + port : "";

                http.open("GET", host + port, /*async*/true);
                http.onreadystatechange = function() {
                    if (http.readyState == 4) {
                        // get the time AFTER calling the URL - request responded
                        var ended = new Date().getTime();
                        // get difference between start time and end time
                        var milliseconds = ended - started;
                    
                        // *optional* callback after pinged the URL
                        if (pong != null) { pong(milliseconds); }
                    }
                };
                try {
                    http.send(null);
                } catch(exception) {
                    // this is expected
                }
            }
            
            ping(CLIENT_INFO[clientName], null, function(m){ console.log(CLIENT_INFO[clientName],": It took "+m+" miliseconds."); isDone(clientName); })
        }

        // check if all CLIENTS[] are done
        function isDone(clientName){

            // when process() is done per client, changed value to true for checking later
            CLIENTS[clientName] = true;

            var allClientsAreDone = true;

            // check if all CLIENTS[] is equal to true
            Object.keys(CLIENTS).forEach(key => {
                if(CLIENTS[key] !== true) allClientsAreDone = false;
            });

            // if all clients are done, close mongodb client and resolve function
            if(allClientsAreDone === true){
                // return 
                res.status(200).send("OK");
            }
        }
        /************** end Functions **************/


        /************** START OF PROCESS **************/
        // execute process() function for each CLIENTS element
        Object.keys(CLIENTS).forEach(key => {
            process(key);
        });
        /************** END OF PROCESS **************/
    }).catch(error => {
        // print error
        console.log("Error in CO",error);
        
        // return error
        res.status(500).send('Error in CO: ' + JSON.stringify(error));
    });
};