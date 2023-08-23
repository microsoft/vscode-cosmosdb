/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from "pg";
import { getAzureAdUserSession, getTokenFunction } from "../../azureAccountUtils";
import { localize } from "../../utils/localize";
import { PostgresClientConfigType, getClientConfigs, testClientConfig } from "../getClientConfig";
import { invalidCredentialsErrorType } from "../postgresConstants";
import { PostgresServerTreeItem } from "./PostgresServerTreeItem";

export const postgresResourceType = "https://ossrdbms-aad.database.windows.net/";

/**
 * Creates an object that can be used to execute a postgres query with connection test and telemetry.
 */
export class PostgresClientConfigFactory {
    public static async getClientConfigFromNode(treeItem: PostgresServerTreeItem, databaseName: string): Promise<ClientConfig> {
        const parsedConnectionString = await treeItem.getFullConnectionString();
        const azureUserSession = await getAzureAdUserSession();

        const clientConfigs = await getClientConfigs(
            parsedConnectionString,
            treeItem.serverType,
            !!treeItem.azureName,
            databaseName,
            azureUserSession?.userId,
            getTokenFunction(treeItem.subscription.credentials, postgresResourceType)
        );

        // @todo: Get this value from setting
        const preferAzureAd = false;
        const clientConfigTypeOrder: PostgresClientConfigType[] = preferAzureAd ?
            ["azureAd", "password", "connectionString"] :
            ["password", "azureAd", "connectionString"];

        // @todo: Add telemetry to figure out the distribution of client config types.
        for (const clientConfigType of clientConfigTypeOrder) {
            const clientConfig: ClientConfig | undefined = clientConfigs[clientConfigType];
            if (!clientConfig) {
                continue;
            }

            try {
                await testClientConfig(clientConfig);
                return clientConfig;
            } catch (error) {
                // If the client config failed during test, skip and try the next available one.
            }
        }

        throw {
            message: localize('mustEnterCredentials', 'Must enter credentials to connect to server.'),
            code: invalidCredentialsErrorType
        };
    }
}
