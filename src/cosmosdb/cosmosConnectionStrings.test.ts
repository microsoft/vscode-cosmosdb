/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { wellKnownEmulatorPassword } from '../constants';
import { parseCosmosConnectionString } from './cosmosConnectionStrings';

describe('cosmosDBConnectionStrings', () => {
    // Testing different ordering, different use of ';', different casing, etc.
    describe('Without database name', () => {
        it('Connection string with empty database', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with leading empty string in AccountEndpoint', () => {
            const parsedCS = parseCosmosConnectionString(
                '    AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with leading empty string in AccountKey', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;    AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with trailing semicolon', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with AccountKey first', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with AccountKey first and trailing semicolon', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with lowercase', () => {
            const parsedCS = parseCosmosConnectionString(
                'accountendpoint=https://abcdef.documents.azure.com:443/;accountkey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with empty Database key', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with empty Database key and trailing semicolon', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountKey=abcdef==;AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with emulator', () => {
            const parsedCS = parseCosmosConnectionString(
                `AccountEndpoint=https://localhost:10255/;AccountKey=${wellKnownEmulatorPassword};`,
            );
            expect(parsedCS.documentEndpoint).toEqual('https://localhost:10255/');
            expect(parsedCS.masterKey).toEqual(wellKnownEmulatorPassword);
            expect(parsedCS.databaseName).toEqual(undefined);
        });

        it('Connection string with other properties', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.hostName).toEqual('abcdef.documents.azure.com');
            expect(parsedCS.port).toEqual('443');
            expect(parsedCS.accountId).toEqual('abcdef.documents.azure.com:443');
            expect(parsedCS.fullId).toEqual('abcdef.documents.azure.com:443');
        });
    });

    // Testing different ordering, different use of ';', different casing, etc.
    describe('With database name', () => {
        it('Connection string with database', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with trailing semicolon', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with Database in the middle', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;Database=abcd;AccountKey=abcdef==',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with Database first and trailing semicolon', () => {
            const parsedCS = parseCosmosConnectionString(
                'Database=abcd;AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;',
            );
            expect(parsedCS.documentEndpoint).toEqual('https://abcdef.documents.azure.com:443/');
            expect(parsedCS.masterKey).toEqual('abcdef==');
            expect(parsedCS.databaseName).toEqual('abcd');
        });

        it('Connection string with other properties', () => {
            const parsedCS = parseCosmosConnectionString(
                'AccountEndpoint=https://abcdef.documents.azure.com:443/;AccountKey=abcdef==;Database=abcd',
            );
            expect(parsedCS.hostName).toEqual('abcdef.documents.azure.com');
            expect(parsedCS.port).toEqual('443');
            expect(parsedCS.accountId).toEqual('abcdef.documents.azure.com:443');
            expect(parsedCS.fullId).toEqual('abcdef.documents.azure.com:443/abcd');
        });
    });

    it('Invalid connection strings', () => {
        expect(() => parseCosmosConnectionString('')).toThrow(Error);
        expect(() => parseCosmosConnectionString('AccountKey=abcdef==')).toThrow(Error);
        expect(() => parseCosmosConnectionString('AccountEndpoint=https://abcdef.documents.azure.com:443/')).toThrow(
            Error,
        );
        expect(() =>
            parseCosmosConnectionString(
                'mongodb://my-mongo:ayO83FFfUoHE97Jm7WbfnpNCqiF0Yq0za2YmvuLAKYJKf7h7hQaRKWfZfsv8Ux41H66Gls7lVPEKlKm0ueSozg==' +
                    '@your-mongo.documents.azure.com:10255/?ssl=true&replicaSet=globaldb',
            ),
        ).toThrow(Error);
    });
});
