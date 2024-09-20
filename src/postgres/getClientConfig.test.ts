/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { postgresDefaultPort } from '../constants';
import { PostgresServerType } from './abstract/models';
import { getClientConfigs } from './getClientConfig';
import { ParsedPostgresConnectionString } from './postgresConnectionStrings';

describe('getClientConfig', () => {
    describe('in subscription', () => {
        // Password only
        it('Should use given port', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                user: 'fake_user',
                password: 'fake_password',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
            );
            expect(clientConfigs.password).toBeDefined();
            expect(clientConfigs.azureAd).toBeUndefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });

        // Password only - Missing port
        it('Should fallback to default port if port is missing', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                user: 'fake_user',
                password: 'fake_password',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
            );
            expect(clientConfigs.password).toBeDefined();
            expect(clientConfigs.azureAd).toBeUndefined();
            expect(clientConfigs.connectionString).toBeUndefined();
            expect(clientConfigs.password?.port).toEqual(parseInt(postgresDefaultPort));
        });

        // Password only - missing username
        it('Should clean password if username is missing', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                password: 'fake_password',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
            );
            expect(clientConfigs.password).toBeUndefined();
            expect(clientConfigs.azureAd).toBeUndefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });

        // No credential
        it('Should create instance if credential is missing', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                user: 'fake_user',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
            );
            expect(clientConfigs.password).toBeUndefined();
            expect(clientConfigs.azureAd).toBeUndefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });

        it('Aad only - Flexible server', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
                'fake_azureAd_userId',
                async () => 'fake_token',
            );
            expect(clientConfigs.password).toBeUndefined();
            expect(clientConfigs.azureAd).toBeDefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });

        it('Aad and password - Flexible server', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                database: 'fake_database',
                user: 'fake_user',
                password: 'fake_password',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
                'fake_azureAd_userId',
                async () => 'fake_token',
            );
            expect(clientConfigs.password).toBeDefined();
            expect(clientConfigs.azureAd).toBeDefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });

        it('Aad only - Single server', async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString('', {
                host: 'fake_host.com',
                port: '1234',
                database: 'fake_database',
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Single,
                true,
                databaseName,
                'fake_azureAd_userId',
                async () => 'fake_token',
            );
            expect(clientConfigs.password).toBeUndefined();
            expect(clientConfigs.azureAd).toBeUndefined();
            expect(clientConfigs.connectionString).toBeUndefined();
        });
    });

    describe('in attachment', () => {
        it('Connection string only', async () => {
            const rawConnectionString = 'postgres://fake_connection_string';
            const parsedConnectionString = new ParsedPostgresConnectionString(rawConnectionString, {
                host: 'fake_host',
                database: null,
            });
            const databaseName = 'fake_database_2';

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                false,
                databaseName,
            );
            expect(clientConfigs.connectionString).toBeDefined();
        });
    });
});
