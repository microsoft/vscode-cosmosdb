/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it } from 'mocha';
import { postgresDefaultPort } from '../../src/constants';
import { PostgresServerType } from '../../src/postgres/abstract/models';
import { getClientConfigs } from '../../src/postgres/getClientConfig';
import { ParsedPostgresConnectionString } from '../../src/postgres/postgresConnectionStrings';

describe("getClientConfig Tests", () => {
    describe("in subscription", () => {
        it("Password only", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    user: "fake_user",
                    password: "fake_password",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfigs.password !== undefined);
            assert(clientConfigs.azureAd === undefined);
            assert(clientConfigs.connectionString === undefined);
        });

        // Cannot test null/undefined host because if it is the case, the code has thrown much earlier when constructing the ParsedPostgresConnectionString object.

        it("Password only - Missing port", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    user: "fake_user",
                    password: "fake_password",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfigs.password !== undefined);
            assert(clientConfigs.azureAd === undefined);
            assert(clientConfigs.connectionString === undefined);
            assert(clientConfigs.password?.port === parseInt(postgresDefaultPort), "Should fallback to default port");
        });

        it("Password only - missing username", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    password: "fake_password",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfigs.password === undefined);
            assert(clientConfigs.azureAd === undefined);
            assert(clientConfigs.connectionString === undefined);
        });

        it("No credential", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    user: "fake_user",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfigs.password === undefined);
            assert(clientConfigs.azureAd === undefined);
            assert(clientConfigs.connectionString === undefined);
        });

        it("Aad only - Flexible server", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
                "fake_azureAd_userId",
                async () => "fake_token"
            );
            assert(clientConfigs.password === undefined);
            assert(clientConfigs.azureAd !== undefined);
            assert(clientConfigs.connectionString === undefined);
        });

        it("Aad and password - Flexible server", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    database: "fake_database",
                    user: "fake_user",
                    password: "fake_password",
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
                "fake_azureAd_userId",
                async () => "fake_token"
            );
            assert(clientConfigs.password !== undefined);
            assert(clientConfigs.azureAd !== undefined);
            assert(clientConfigs.connectionString === undefined);
        });

        it("Aad only - Single server", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(
                parsedConnectionString,
                PostgresServerType.Single,
                true,
                databaseName,
                "fake_azureAd_userId",
                async () => "fake_token"
            );
            assert(clientConfigs.password === undefined);
            assert(clientConfigs.azureAd === undefined);
            assert(clientConfigs.connectionString === undefined);
        });
    });

    describe("in attachment", () => {
        it("Connection string only", async () => {
            const rawConnectionString = "postgres://fake_connection_string";
            const parsedConnectionString = new ParsedPostgresConnectionString(
                rawConnectionString,
                {
                    host: "fake_host",
                    database: null
                }
            );
            const databaseName = "fake_database_2";

            const clientConfigs = await getClientConfigs(parsedConnectionString, PostgresServerType.Flexible, false, databaseName);
            assert(clientConfigs.connectionString !== undefined);
        });
    });
});
