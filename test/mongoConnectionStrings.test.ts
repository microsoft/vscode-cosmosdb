/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { getDatabaseNameFromConnectionString, addDatabaseToConnectionString } from '../src/mongo/mongoConnectionStrings';

function testItemsFromConnectionString(connectionString: string, expectedItems: string[]) {
    let database = getDatabaseNameFromConnectionString(connectionString);
    assert.equal(database, expectedItems[2]);
}

function testDatabaseToConnectionString(connectionString: string, databaseName: string, expectedConnectionString: string | undefined) {
    let databaseConnectionString = addDatabaseToConnectionString(connectionString, databaseName);
    assert.equal(databaseConnectionString, expectedConnectionString);
}

suite(`mongoCollectionStrings`, () => {
    test(`getItemFromConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        testItemsFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', undefined, '?ssl=true&replicaSet=globaldb']);
        testItemsFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', 'our-mongo', '?ssl=true&replicaSet=globaldb']);
        testItemsFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/`, ['mongodb', 'my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255', undefined, undefined]);

        testItemsFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', undefined, undefined]);
        testItemsFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', undefined, undefined]);
        testItemsFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/dbname`, ['mongodb', 'dbuser:dbpassword@dbname.mlab.com:14118', 'dbname', undefined]);

        testItemsFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', undefined, '?replicaSet=test']);
        testItemsFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', 'my-database', '?replicaSet=test']);

        testItemsFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', undefined, undefined]);
        testItemsFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', undefined, undefined]);
        testItemsFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/db`, ['mongodb', 'r1.example.net:27017,r2.example.net:27017', 'db', undefined]);

        testItemsFromConnectionString(`mongodb+srv://server.example.com/`, ['mongodb+srv', 'server.example.com', undefined, undefined]);
        testItemsFromConnectionString(`mongodb+srv://server.example.com/db`, ['mongodb+srv', 'server.example.com', 'db', undefined]);

        testItemsFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', undefined, '?replicaSet=mySet&authSource=authDB']);
        testItemsFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/MYDB?replicaSet=mySet&authSource=authDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', 'MYDB', '?replicaSet=mySet&authSource=authDB']);

        testItemsFromConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, ['mongodb+srv', 'server.example.com', undefined, '?connectTimeoutMS=300000&authSource=aDifferentAuthDB']);
        testItemsFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, ['mongodb', 'mongodb1.example.com:27317,mongodb2.example.com:27017', 'my_db', '?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB']);
        testItemsFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, ['mongodb', 'db1.example.net:27017,db2.example.net:2500', undefined, '?replicaSet=test&connectTimeoutMS=300000']);
        testItemsFromConnectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, ['mongodb', 'host.example.com', 'hello', '?readPreference=secondary&maxStalenessSeconds=120']);
        testItemsFromConnectionString(`mongodb://localhost`, ['mongodb', 'localhost', undefined, undefined]);
        testItemsFromConnectionString(`mongodb://localhost/db`, ['mongodb', 'localhost', 'db', undefined]);
        testItemsFromConnectionString(`mongodb://sysop:moon@localhost/records`, ['mongodb', 'sysop:moon@localhost', 'records', undefined]);
        testItemsFromConnectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/db`, ['mongodb', '%2Ftmp%2Fmongodb-27017.sock', 'db', undefined]);
        testItemsFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc', undefined]);

        // special characters
        testItemsFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc.def', undefined]);
        testItemsFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def-ghi_jkl`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'abc.def-ghi_jkl', undefined]);
        testItemsFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/I like spaces`, ['mongodb', 'router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017', 'I like spaces', undefined]);

        // emulator: mongodb://localhost:C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==@localhost:10255?ssl=true
    });

    test('addDatabaseToConnectionString', () => {
        testDatabaseToConnectionString(`mongodb://a.b.c/?readPreference=secondary&maxStalenessSeconds=1201`, 'realdatabase', 'mongodb://a.b.c/realdatabase?readPreference=secondary&maxStalenessSeconds=1201');
        testDatabaseToConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, 'somedatabase', 'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb');
        testDatabaseToConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, 'our-mongo', 'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb')

        testDatabaseToConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, 'mydata', 'mongodb://dbuser:dbpassword@dbname.mlab.com:14118/mydata');
        testDatabaseToConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, 'database', 'mongodb://dbuser:dbpassword@dbname.mlab.com:14118/database');
        testDatabaseToConnectionString(`mongodb+srv://dbuser:dbpassword@dbname.mlab.com:14118/database`, 'database', 'mongodb+srv://dbuser:dbpassword@dbname.mlab.com:14118/database');

        testDatabaseToConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, 'my-database', 'mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test');
        testDatabaseToConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?`, 'my-database', 'mongodb://db1.example.net:27017,db2.example.net:2500/my-database?');

        testDatabaseToConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`, 'basetoadd', 'mongodb+srv://server.example.com/basetoadd?connectTimeoutMS=300000&authSource=aDifferentAuthDB?');
        testDatabaseToConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`, '/data', 'mongodb+srv://server.example.com//data?connectTimeoutMS=300000&authSource=aDifferentAuthDB?');

        // special characters
        testDatabaseToConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/?`, 'abc.def.-ghi_jkl', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def.-ghi_jkl?');
        testDatabaseToConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017`, 'i love spaces', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/i love spaces');
    });
});

