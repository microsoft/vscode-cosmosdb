/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { getDatabaseNameFromConnectionString } from '../src/mongo/mongoConnectionStrings';

function testDatabaseFromConnectionString(connectionString: string, expectedDatabase: string | undefined) {
    let database = getDatabaseNameFromConnectionString(connectionString);
    assert.equal(database, expectedDatabase);
}

suite(`mongoCollectionStrings`, () => {
    test(`getDatabaseNameFromConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        testDatabaseFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, undefined);
        testDatabaseFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, "our-mongo");
        testDatabaseFromConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, undefined);

        testDatabaseFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, undefined);
        testDatabaseFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, undefined);
        testDatabaseFromConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/dbname`, `dbname`);

        testDatabaseFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, undefined);
        testDatabaseFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test`, "my-database");

        testDatabaseFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, undefined);
        testDatabaseFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, undefined);
        testDatabaseFromConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/db`, "db");

        testDatabaseFromConnectionString(`mongodb+srv://server.example.com/`, undefined);
        testDatabaseFromConnectionString(`mongodb+srv://server.example.com/db`, "db");

        testDatabaseFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, undefined);
        testDatabaseFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/MYDB?replicaSet=mySet&authSource=authDB`, "MYDB");

        testDatabaseFromConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, undefined);
        testDatabaseFromConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, "my_db");
        testDatabaseFromConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, undefined);
        testDatabaseFromConnectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, "hello");
        testDatabaseFromConnectionString(`mongodb://localhost`, undefined);
        testDatabaseFromConnectionString(`mongodb://localhost/db`, "db");
        testDatabaseFromConnectionString(`mongodb://sysop:moon@localhost/records`, "records");
        testDatabaseFromConnectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/db`, "db");
        testDatabaseFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc`, "abc");

        // special characters
        testDatabaseFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def`, "abc.def");
        testDatabaseFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def-ghi_jkl`, "abc.def-ghi_jkl");
        testDatabaseFromConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/I like spaces`, "I like spaces");

        // emulator: mongodb://localhost:C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==@localhost:10255?ssl=true
    });
});

