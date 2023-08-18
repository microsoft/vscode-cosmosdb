/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it } from 'mocha';
import { postgresDefaultPort } from '../../src/constants';
import { PostgresServerType } from '../../src/postgres/abstract/models';
import { getClientConfig } from '../../src/postgres/getClientConfig';
import { ParsedPostgresConnectionString } from '../../src/postgres/postgresConnectionStrings';

describe("getClientConfig Tests", () => {
    describe("in subscription", () => {
        it("Get client config - username password", async () => {
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

            const clientConfig = await getClientConfig(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfig?.user === "fake_user");
            assert(clientConfig?.password === "fake_password");
            assert(clientConfig?.host === "fake_host.com");
            assert(clientConfig?.port === 1234);
        });

        // Cannot test null/undefined host because if it is the case, the code has thrown much earlier when constructing the ParsedPostgresConnectionString object.

        it("Get client config - missing port", async () => {
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

            const clientConfig = await getClientConfig(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfig?.user === "fake_user");
            assert(clientConfig?.password === "fake_password");
            assert(clientConfig?.host === "fake_host.com");
            assert(clientConfig?.port === parseInt(postgresDefaultPort), "Should fallback to default port");
        });

        it("Get client config - missing username nor aad credential", async () => {
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

            const clientConfig = await getClientConfig(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfig === undefined);
        });

        it("Get client config - missing password nor aad credential", async () => {
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

            const clientConfig = await getClientConfig(parsedConnectionString, PostgresServerType.Flexible, true, databaseName);
            assert(clientConfig === undefined);
        });

        it("Get client config - flexible aad", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfig = await getClientConfig(
                parsedConnectionString,
                PostgresServerType.Flexible,
                true,
                databaseName,
                "fake_azureAd_userId",
                async () => "fake_token"
            );
            assert(clientConfig?.user === "fake_azureAd_userId");
            assert(typeof clientConfig?.password === "function");
            assert(clientConfig?.host === "fake_host.com");
            assert(clientConfig?.port === 1234);
        });

        it("Get client config - single aad", async () => {
            const parsedConnectionString = new ParsedPostgresConnectionString(
                "",
                {
                    host: "fake_host.com",
                    port: "1234",
                    database: "fake_database"
                }
            );
            const databaseName = "fake_database_2";

            const clientConfig = await getClientConfig(
                parsedConnectionString,
                PostgresServerType.Single,
                true,
                databaseName,
                "fake_azureAd_userId",
                async () => "fake_token"
            );
            assert(clientConfig === undefined);
        });


        describe("in attachment", () => {
            it("Get client config - connection string", async () => {
                const rawConnectionString = "postgres://fake_connection_string";
                const parsedConnectionString = new ParsedPostgresConnectionString(
                    rawConnectionString,
                    {
                        host: "fake_host",
                        database: null
                    }
                );
                const databaseName = "fake_database_2";

                const clientConfig = await getClientConfig(parsedConnectionString, PostgresServerType.Flexible, false, databaseName);
                const augmentedConnectionString = `${rawConnectionString}/${databaseName}`;
                assert(clientConfig?.connectionString === augmentedConnectionString);
            });
        });
    });
});
