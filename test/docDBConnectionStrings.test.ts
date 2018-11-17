/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { parseDocDBConnectionString } from '../src/docdb/docDBConnectionStrings';
import { emulatorPassword } from '../src/constants';


function testConnectionString(connectionString: string, expectedEndpoint: string, expectedKey: string, expectedDatabaseName: string | undefined) {
    let parsedCS = parseDocDBConnectionString(connectionString);
    assert.equal(parsedCS.documentEndpoint, expectedEndpoint);
    assert.equal(parsedCS.masterKey, expectedKey);
    assert.equal(parsedCS.databaseName, expectedDatabaseName);
}

suite(`docDBConnectionStrings`, () => {
    test(`Without database name`, () => {
        // Testing different ordering, different use of ';', different casing, etc.
        testConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('accountendpoint=https://abcdef.documents.azure.com:443/;accountkey=abcdef==', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);
        testConnectionString('AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=;', 'https://abcdef.documents.azure.com:443/', 'abcdef==', undefined);

        // emulator
        testConnectionString(`AccountEndpoint=https://localhost:10255/;AccountKey=${emulatorPassword};`, 'https://localhost:10255/', emulatorPassword, undefined);

        // Testing other properties
        let parsedCS = parseDocDBConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;');
        assert.equal(parsedCS.hostName, 'abcdef.documents.azure.com');
        assert.equal(parsedCS.port, '443');
        assert.equal(parsedCS.accountId, 'abcdef.documents.azure.com:443');
        assert.equal(parsedCS.fullId, 'abcdef.documents.azure.com:443');
    });

    test(`With database name`, () => {
        // Testing different ordering, different use of ';', different casing, etc.
        testConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd', 'https://abcdef.documents.azure.com:443/', 'abcdef==', 'abcd');
        testConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd;', 'https://abcdef.documents.azure.com:443/', 'abcdef==', 'abcd');
        testConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=abcd;AccountKey=abcdef==', 'https://abcdef.documents.azure.com:443/', 'abcdef==', 'abcd');
        testConnectionString('Database=abcd;AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;', 'https://abcdef.documents.azure.com:443/', 'abcdef==', 'abcd');

        // Testing other properties
        let parsedCS = parseDocDBConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd');
        assert.equal(parsedCS.hostName, 'abcdef.documents.azure.com');
        assert.equal(parsedCS.port, '443');
        assert.equal(parsedCS.accountId, 'abcdef.documents.azure.com:443');
        assert.equal(parsedCS.fullId, 'abcdef.documents.azure.com:443/abcd');
    });

    test(`Invalid connection strings`, () => {
        assert.throws(() => parseDocDBConnectionString(''));
        assert.throws(() => parseDocDBConnectionString('AccountKey=abcdef=='));
        assert.throws(() => parseDocDBConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/'));
        assert.throws(() => parseDocDBConnectionString('mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb'));
    });
});

