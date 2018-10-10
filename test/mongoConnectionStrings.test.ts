/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { parseConnectionString } from '../src/mongo/mongoConnectionStrings';

function testParseConnectionString(connectionString: string, expectedDatabase: string[]) {
    let database = parseConnectionString(connectionString);
    database.shift();
    assert.equal(database.values, expectedDatabase.values);
}

suite(`mongoCollectionStrings`, () => {
    test(`getDatabaseNameFromConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        testParseConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', undefined, '?ssl=true&replicaSet=globaldb']);
        testParseConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', 'our-mongo', '?ssl=true&replicaSet=globaldb']);
        testParseConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', undefined, '?ssl=true&replicaSet=globaldb']);

        testParseConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', undefined, undefined]);
        testParseConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', undefined, undefined]);
        testParseConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/dbname`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', 'dbname', undefined]);

        testParseConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', undefined, '?replicaSet=test']);
        testParseConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', 'my-database', '?replicaSet=test']);

        testParseConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', undefined, undefined]);
        testParseConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', undefined, undefined]);
        testParseConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/db`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', 'db', undefined]);

        testParseConnectionString(`mongodb+srv://server.example.com/`, ['mongodb+srv', 'server.example.com', undefined, undefined]);
        testParseConnectionString(`mongodb+srv://server.example.com/db`, ['mongodb+srv', 'server.example.com', 'db', undefined]);

        testParseConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', undefined, '?replicaSet=mySet&authSource=authDB']);
        testParseConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/MYDB?replicaSet=mySet&authSource=authDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', 'MYDB', '?replicaSet=mySet&authSource=authDB']);

        testParseConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, ['mongodb+srv', 'server.example.com', undefined, '?connectTimeoutMS=300000&authSource=aDifferentAuthDB']);
        testParseConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', 'my_db', '?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB']);
        testParseConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', undefined, '?replicaSet=test&connectTimeoutMS=300000']);
        testParseConnectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, ['mongodb', 'host.example.com', 'hello', '?readPreference=secondary&maxStalenessSeconds=120']);
        testParseConnectionString(`mongodb://localhost`, ['mongodb', 'localhost', undefined, undefined]);
        testParseConnectionString(`mongodb://localhost/db`, ['mongodb', 'localhost', 'db', undefined]);
        testParseConnectionString(`mongodb://sysop:moon@localhost/records`, ['mongodb', 'sysop:moon@localhost', 'records', undefined]);
        testParseConnectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/db`, ['mongodb', '%2Ftmp%2Fmongodb-27017.sock', 'db', undefined]);
        testParseConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc', undefined]);

        // special characters
        testParseConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc.def', undefined]);
        testParseConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def-ghi_jkl`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc.def-ghi_jkl', undefined]);
        testParseConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/I like spaces`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'I like spaces', undefined]);

        // emulator: mongodb://localhost:C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==@localhost:10255?ssl=true
    });
});

