/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from "pg";
import { ConnectionOptions } from "tls";
import { BaltimoreCyberTrustRoot, DigiCertGlobalRootCA, DigiCertGlobalRootG2, postgresDefaultPort } from "../constants";
import { localize } from "../utils/localize";
import { nonNullProp } from "../utils/nonNull";
import { PostgresServerType } from "./abstract/models";
import { addDatabaseToConnectionString } from "./postgresConnectionStrings";
import { invalidCredentialsErrorType } from "./tree/PostgresDatabaseTreeItem";
import { PostgresServerTreeItem } from "./tree/PostgresServerTreeItem";

export async function getClientConfig(treeItem: PostgresServerTreeItem, databaseName: string): Promise<ClientConfig> {
    let clientConfig: ClientConfig;
    const parsedCS = await treeItem.getFullConnectionString();
    if (treeItem.azureName) {
        const username: string | undefined = parsedCS.username;
        const password: string | undefined = parsedCS.password;

        const sslAzure: ConnectionOptions = {
            // Always provide the certificate since it is accepted even when SSL is disabled
            // Single Server Root Cert --> BaltimoreCyberTrustRoot (Current), DigiCertGlobalRootG2 (TBA)
            // Flexible Server Root Cert --> DigiCertGlobalRootCA. More info: https://aka.ms/AAd75x5
            ca: treeItem.serverType === PostgresServerType.Single ? [BaltimoreCyberTrustRoot, DigiCertGlobalRootG2] : [DigiCertGlobalRootCA]
        };
        if ((username && password)) {
            const host = nonNullProp(parsedCS, 'hostName');
            const port: number = parsedCS.port ? parseInt(parsedCS.port) : parseInt(postgresDefaultPort);
            clientConfig = { user: username, password: password, ssl: sslAzure, host, port, database: databaseName };
        } else {
            throw {
                message: localize('mustEnterCredentials', 'Must enter credentials to connect to server.'),
                code: invalidCredentialsErrorType
            };
        }
    } else {
        let connectionString = parsedCS.connectionString;
        if (!parsedCS.databaseName) {
            connectionString = addDatabaseToConnectionString(connectionString, databaseName);
        }
        clientConfig = { connectionString: connectionString };
    }

    const client = new Client(clientConfig);
    // Ensure the client config is valid before returning
    try {
        await client.connect();
        return clientConfig;
    } finally {
        client.end;
    }
}
