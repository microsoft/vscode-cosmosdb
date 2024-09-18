/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { addDatabaseToConnectionString } from '../extension.bundle';

function testAddDatabaseToConectionString(
    connectionString: string,
    databaseName: string,
    expectedConnectionString: string | undefined,
): void {
    const modifiedConnectionString = addDatabaseToConnectionString(connectionString, databaseName);
    assert.equal(modifiedConnectionString, expectedConnectionString);
}

suite(`postgresConnectionStrings`, () => {
    test(`addDatabaseToConnectionString`, () => {
        // Connection strings follow the following format (https://www.postgresql.org/docs/12/libpq-connect.html):
        // postgres://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]

        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432/`,
            'testdb',
            'postgres://user:password@test:5432/testdb',
        );
        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432/testdb`,
            'testdb2',
            `postgres://user:password@test:5432/testdb2`,
        );

        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432`,
            'testdb',
            'postgres://user:password@test:5432/testdb',
        );
        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432/?ssl=true&sslmode=require`,
            'testdb',
            `postgres://user:password@test:5432/testdb?ssl=true&sslmode=require`,
        );

        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432/testdb?ssl=true&sslmode=require`,
            'testdb2',
            `postgres://user:password@test:5432/testdb2?ssl=true&sslmode=require`,
        );

        testAddDatabaseToConectionString(
            `postgres://user:password@test:5432/`,
            `test%20`,
            `postgres://user:password@test:5432/test%2520`,
        );
    });
});
