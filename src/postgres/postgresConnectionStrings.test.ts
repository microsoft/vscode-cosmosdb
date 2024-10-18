/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDatabaseToConnectionString } from './postgresConnectionStrings';

// Connection strings follow the following format (https://www.postgresql.org/docs/12/libpq-connect.html):
// postgres://[username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
describe(`postgresConnectionStrings`, () => {
    describe(`addDatabaseToConnectionString`, () => {
        it(`should add a database to a connection string with trailing slash`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432/`,
                'testdb',
            );
            expect(modifiedConnectionString).toEqual('postgres://user:password@test:5432/testdb');
        });

        it(`should add a database to a connection string if database exists in url`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432/testdb`,
                'testdb2',
            );
            expect(modifiedConnectionString).toEqual(`postgres://user:password@test:5432/testdb2`);
        });

        it(`should add a database to a connection string without a database`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432`,
                'testdb',
            );
            expect(modifiedConnectionString).toEqual('postgres://user:password@test:5432/testdb');
        });

        it(`should add a database to a connection string with options`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432/?ssl=true&sslmode=require`,
                'testdb',
            );
            expect(modifiedConnectionString).toEqual(
                `postgres://user:password@test:5432/testdb?ssl=true&sslmode=require`,
            );
        });

        it(`should add a database to a connection string with options and database`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432/testdb?ssl=true&sslmode=require`,
                'testdb2',
            );
            expect(modifiedConnectionString).toEqual(
                `postgres://user:password@test:5432/testdb2?ssl=true&sslmode=require`,
            );
        });

        it(`should add a database to a connection string with special characters`, () => {
            const modifiedConnectionString = addDatabaseToConnectionString(
                `postgres://user:password@test:5432/`,
                `test%20`,
            );
            expect(modifiedConnectionString).toEqual(`postgres://user:password@test:5432/test%2520`);
        });
    });
});
