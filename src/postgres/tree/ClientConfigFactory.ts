/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, parseError } from "@microsoft/vscode-azext-utils";
import { ClientConfig } from "pg";
import { getAzureAdUserSession, getTokenFunction } from "../../azureAccountUtils";
import { localize } from "../../utils/localize";
import { PostgresClientConfigType, getClientConfigs, testClientConfig } from "../getClientConfig";
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, timeoutErrorType } from "../postgresConstants";
import { PostgresServerTreeItem } from "./PostgresServerTreeItem";

export const postgresResourceType = "https://ossrdbms-aad.database.windows.net/";

/**
 * Creates an object that can be used to execute a postgres query with connection test and telemetry.
 */
export class PostgresClientConfigFactory {
    public static async getClientConfigFromNode(treeItem: PostgresServerTreeItem, databaseName: string): Promise<{
        type: "azureAd" | "password" | "connectionString",
        clientConfig: ClientConfig
    }> {
        const parsedConnectionString = await treeItem.getFullConnectionString();
        const azureUserSession = await getAzureAdUserSession();

        let hasSubscription: boolean = false;
        let tokenFunction: (() => Promise<string>) | undefined = undefined;
        try {
            const subscription = treeItem.subscription;
            hasSubscription = true;
            tokenFunction = getTokenFunction(subscription.credentials, postgresResourceType);
        } catch (error) {
            hasSubscription = false;
        }
        const clientConfigs = await getClientConfigs(
            parsedConnectionString,
            treeItem.serverType,
            hasSubscription,
            databaseName,
            azureUserSession?.userId,
            tokenFunction
        );

        const clientConfigTypeOrder: PostgresClientConfigType[] = ["azureAd", "password", "connectionString"];

        for (const clientConfigType of clientConfigTypeOrder) {
            const clientConfig: ClientConfig | undefined = clientConfigs[clientConfigType];
            if (!clientConfig) {
                continue;
            }

            try {
                await callWithTelemetryAndErrorHandling<void>("postgreSQL.testClientConfig", async (context) => {
                    context.errorHandling.rethrow = true;
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.clientConfigType = clientConfigType;
                    await testClientConfig(clientConfig);
                });
                return {
                    type: clientConfigType,
                    clientConfig
                };
            } catch (error) {
                const parsedError = parseError(error);
                if (parsedError.errorType === invalidCredentialsErrorType) {
                    // If the client config failed with invalid credential error, skip and try the next available one.
                } else if (parsedError.errorType === firewallNotConfiguredErrorType || parsedError.errorType === timeoutErrorType) {
                    // The time out error are common when the firewall rules doesn't grant access from the current IP address.
                    // If the client is blocked by the firewall, let the user go to Azure Portal to grant access.
                    throw {
                        message: localize("mustConfigureFirewall", 'Must configure firewall from Azure Portal to grant access.'),
                        code: firewallNotConfiguredErrorType
                    };
                } else {
                    throw error;
                }
            }
        }

        throw {
            message: localize('mustEnterCredentials', 'Must enter credentials to connect to server.'),
            code: invalidCredentialsErrorType
        };
    }
}
