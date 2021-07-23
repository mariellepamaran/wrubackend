const {MongoClient} = require('mongodb');

async function main(){
    /**
     * Connection URI. Update <username>, <password>, and <your-cluster-url> to reflect your cluster.
     * See https://docs.mongodb.com/ecosystem/drivers/node/ for more details
     */

    const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";
 
    MongoClient.connect(uri, function(err, db) {
        if (err) throw err;
        var dbo = db.db("wru");
        var myobj = { name: "Company Inc", address: "Highway 37" };
        dbo.collection("test").insertOne(myobj, function(err, res) {
            if (err) throw err;
            console.log("1 document inserted");
            db.close();
        });
    }); 
}

main().catch(console.error);


// const {MongoClient} = require('mongodb');


// async function main(){
//     /**
//      * Connection URI. Update <username>, <password>, and <your-cluster-url> to reflect your cluster.
//      * See https://docs.mongodb.com/ecosystem/drivers/node/ for more details
//      */

//     const uri = "mongodb+srv://marielle:uuKjU0fXcTEio7H0@wru-o1bdm.gcp.mongodb.net/wru?retryWrites=true&w=majority&authSource=admin";
//     // const uri = "mongodb://marielle:uuKjU0fXcTEio7H0@wru-shard-00-00-o1bdm.gcp.mongodb.net:27017,wru-shard-00-01-o1bdm.gcp.mongodb.net:27017,wru-shard-00-02-o1bdm.gcp.mongodb.net:27017/wru?ssl=true&replicaSet=wru-shard-0&authSource=admin&retryWrites=true&w=majority";
 
//     const client = new MongoClient(uri);
 
//     try {
//         // Connect to the MongoDB cluster
//         await client.connect();
 
//         // Make the appropriate DB calls
//         await  listDatabases(client);
 
//     } catch (e) {
//         console.error(e);
//     } finally {
//         await client.close();
//     }
// }

// main().catch(console.error);

// // async function listDatabases(client){
// //     databasesList = await client.db().admin().listDatabases();
 
// //     console.log("Databases:");
// //     databasesList.databases.forEach(db => console.log(` - ${db.name}`));
// // };
 