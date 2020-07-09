/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { addDatabaseToAccountConnectionString, emulatorPassword, encodeMongoConnectionString, getDatabaseNameFromConnectionString, isCosmosEmulatorConnectionString } from '../extension.bundle';

function testDatabaseToAccountConnectionString(connectionString: string, databaseName: string, expectedConnectionString: string | undefined): void {
    const databaseConnectionString = addDatabaseToAccountConnectionString(connectionString, databaseName);
    assert.equal(databaseConnectionString, expectedConnectionString);
}

function testDatabaseNameFromConectionString(connectionString: string, expectedDatabaseName: string | undefined): void {
    const databaseName = getDatabaseNameFromConnectionString(connectionString);
    assert.equal(databaseName, expectedDatabaseName);
}

function testIsCosmosEmulatorConnectionString(connectionString: string, expected: boolean): void {
    const actual: boolean = isCosmosEmulatorConnectionString(connectionString);
    assert.equal(actual, expected);
}

function testEncodeMongoConnectionString(connectionString: string, expectedConnectionString: string): void {
    connectionString = encodeMongoConnectionString(connectionString);
    assert.equal(connectionString, expectedConnectionString);
}

suite(`mongoCollectionStrings`, () => {
    test(`getDatabaseNameFromConnectionString`, () => {
        // Connection strings follow the following format (https://docs.mongodb.com/manual/reference/connection-string/):
        // mongodb://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        testDatabaseNameFromConectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, undefined);
        testDatabaseNameFromConectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, 'our-mongo');

        testDatabaseNameFromConectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, undefined);
        testDatabaseNameFromConectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, undefined);
        testDatabaseNameFromConectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/dbname`, `dbname`);

        testDatabaseNameFromConectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, undefined);
        testDatabaseNameFromConectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test`, 'my-database');

        testDatabaseNameFromConectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, undefined);
        testDatabaseNameFromConectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, undefined);
        testDatabaseNameFromConectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/db`, 'db');

        testDatabaseNameFromConectionString(`mongodb+srv://server.example.com/`, undefined);
        testDatabaseNameFromConectionString(`mongodb+srv://server.example.com/db`, 'db');

        testDatabaseNameFromConectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, undefined);
        testDatabaseNameFromConectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/MYDB?replicaSet=mySet&authSource=authDB`, 'MYDB');

        testDatabaseNameFromConectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, undefined);
        testDatabaseNameFromConectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, 'my_db');
        testDatabaseNameFromConectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, undefined);
        testDatabaseNameFromConectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, 'hello');
        testDatabaseNameFromConectionString(`mongodb://localhost`, undefined);
        testDatabaseNameFromConectionString(`mongodb://localhost/db`, 'db');
        testDatabaseNameFromConectionString(`mongodb://sysop:moon@localhost/records`, 'records');
        testDatabaseNameFromConectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/db`, 'db');
        testDatabaseNameFromConectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc`, 'abc');

        // special characters
        testDatabaseNameFromConectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def`, 'abc.def');
        testDatabaseNameFromConectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def-ghi_jkl`, 'abc.def-ghi_jkl');
        testDatabaseNameFromConectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/Icantlikespaces`, 'Icantlikespaces');

        // emulator: mongodb://localhost:C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==@localhost:10255?ssl=true
        testDatabaseNameFromConectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin?ssl=true`, 'admin');
        testDatabaseNameFromConectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin-master?ssl=true`, 'admin-master');
        // test characters mentioned in : https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Database-Names-for-Windows
        testDatabaseNameFromConectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin!@#%^*()-_,[]?ssl=true`, 'admin!@#%^*()-_,[]');

    });

    test('addDatabaseToAccountConnectionString', () => {
        testDatabaseToAccountConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, 'somedatabase', 'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/somedatabase?ssl=true&replicaSet=globaldb');
        testDatabaseToAccountConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, 'our-mongo', 'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb');

        testDatabaseToAccountConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, 'mydata', 'mongodb://dbuser:dbpassword@dbname.mlab.com:14118/mydata');
        testDatabaseToAccountConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, 'database', 'mongodb://dbuser:dbpassword@dbname.mlab.com:14118/database');
        testDatabaseToAccountConnectionString(`mongodb+srv://dbuser:dbpassword@dbname.mlab.com:14118/database`, 'database', 'mongodb+srv://dbuser:dbpassword@dbname.mlab.com:14118/database');

        testDatabaseToAccountConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, 'my-database', 'mongodb://db1.example.net:27017,db2.example.net:2500/my-database?replicaSet=test');
        testDatabaseToAccountConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?`, 'my-database', 'mongodb://db1.example.net:27017,db2.example.net:2500/my-database?');

        testDatabaseToAccountConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, 'undefined', 'mongodb://r1.example.net:27017,r2.example.net:27017/undefined');
        testDatabaseToAccountConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, 'undefined', 'mongodb://r1.example.net:27017,r2.example.net:27017/undefined');
        testDatabaseToAccountConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/{SQL}data`, '(NoSQL)data', 'mongodb://r1.example.net:27017,r2.example.net:27017/(NoSQL)data');

        testDatabaseToAccountConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, 'undefined', 'mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/undefined?replicaSet=mySet&authSource=authDB');
        testDatabaseToAccountConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, 'MYDB', 'mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/MYDB?replicaSet=mySet&authSource=authDB');

        testDatabaseToAccountConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`, 'basetoadd', 'mongodb+srv://server.example.com/basetoadd?connectTimeoutMS=300000&authSource=aDifferentAuthDB?');
        testDatabaseToAccountConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`, '/data', 'mongodb+srv://server.example.com//data?connectTimeoutMS=300000&authSource=aDifferentAuthDB?');

        testDatabaseToAccountConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, '', 'mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB');
        testDatabaseToAccountConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, 'not_mydatabase', 'mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/not_mydatabase?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB');
        testDatabaseToAccountConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, '', 'mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000');
        testDatabaseToAccountConnectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, 'hellno', 'mongodb://host.example.com/hellno?readPreference=secondary&maxStalenessSeconds=120');
        testDatabaseToAccountConnectionString(`mongodb://localhost`, '', 'mongodb://localhost/');
        testDatabaseToAccountConnectionString(`mongodb://localhost/db`, 'new{}db', 'mongodb://localhost/new{}db');
        testDatabaseToAccountConnectionString(`mongodb://sysop:moon@localhost/records`, 'records', 'mongodb://sysop:moon@localhost/records');
        testDatabaseToAccountConnectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/onemorefundatabase`, 'notfun', 'mongodb://%2Ftmp%2Fmongodb-27017.sock/notfun');
        testDatabaseToAccountConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/wowsomethingnew?ssl=true`, 'notsure', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/notsure?ssl=true');

        // special characters
        testDatabaseToAccountConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc...`, 'abc.def', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def');
        testDatabaseToAccountConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/?`, 'abc.def.-ghi_jkl', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc.def.-ghi_jkl?');
        testDatabaseToAccountConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017`, 'icantlikespaces', 'mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/icantlikespaces');

        // Emulator
        testDatabaseToAccountConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, 'admin', `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin?ssl=true`);
        // Collection within emulator
        testDatabaseToAccountConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, 'admin/level1/level2', `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin/level1/level2?ssl=true`);
        testDatabaseToAccountConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, 'admin-master', `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin-master?ssl=true`);
        testDatabaseToAccountConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, 'admin!@#%^*()-_,[]', `mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/admin!@#%^*()-_,[]?ssl=true`);
    });

    test('isCosmosEmulatorConnectionString', () => {
        testIsCosmosEmulatorConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/our-mongo?ssl=true&replicaSet=globaldb`, false);

        testIsCosmosEmulatorConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118/`, false);
        testIsCosmosEmulatorConnectionString(`mongodb+srv://dbuser:dbpassword@dbname.mlab.com:14118/database`, false);

        testIsCosmosEmulatorConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/my-database?`, false);

        testIsCosmosEmulatorConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://r1.example.net:27017,r2.example.net:27017/{SQL}data`, false);

        testIsCosmosEmulatorConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/?replicaSet=mySet&authSource=authDB`, false);

        testIsCosmosEmulatorConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://mongodb1.example.com:27317,mongodb2.example.com:27017/my_db?connectTimeoutMS=300000&replicaSet=mySet&authSource=aDifferentAuthDB`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test&connectTimeoutMS=300000`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://host.example.com/hello?readPreference=secondary&maxStalenessSeconds=120`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://localhost`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://localhost/db`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://sysop:moon@localhost/records`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://%2Ftmp%2Fmongodb-27017.sock/onemorefundatabase`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/wowsomethingnew?ssl=true`, false);

        testIsCosmosEmulatorConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/abc...`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017/?`, false);
        testIsCosmosEmulatorConnectionString(`mongodb://router1.example.com:27017,router2.example2.com:27017,router3.example3.com:27017`, false);

        // Emulator
        testIsCosmosEmulatorConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, true);
        testIsCosmosEmulatorConnectionString(`mongodb://127.0.0.1:${encodeURIComponent(emulatorPassword)}@127.0.0.1:10255/?ssl=true`, true);
        testIsCosmosEmulatorConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/database?ssl=true`, true);
    });

    test('encodeMongoConnectionString', () => {
        testEncodeMongoConnectionString(`mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`, `mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg%3D%3D@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb`);
        testEncodeMongoConnectionString(`mongodb://dbuser:dbpassword@dbname.mlab.com:14118`, `mongodb://dbuser:dbpassword@dbname.mlab.com:14118`);
        testEncodeMongoConnectionString(`mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`, `mongodb://db1.example.net:27017,db2.example.net:2500/?replicaSet=test`);
        testEncodeMongoConnectionString(`mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`, `mongodb+srv://server.example.com/?connectTimeoutMS=300000&authSource=aDifferentAuthDB?`);
        testEncodeMongoConnectionString(`mongodb://localhost`, `mongodb://localhost`);
        testEncodeMongoConnectionString(`mongodb://localhost:${encodeURIComponent(emulatorPassword)}@localhost:10255/?ssl=true`, `mongodb://localhost:${encodeURIComponent(encodeURIComponent(emulatorPassword))}@localhost:10255/?ssl=true`);
        testEncodeMongoConnectionString(`mongodb://username@example.com:password@localhost/`, `mongodb://username%40example.com:password@localhost/`);
        testEncodeMongoConnectionString(`mongodb://crazy@:/%username:even@crazier%/password@localhost/`, `mongodb://crazy%40%3A%2F%25username:even%40crazier%25%2Fpassword@localhost/`);
    });
});
