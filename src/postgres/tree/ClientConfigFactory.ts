/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    parseError,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type ClientConfig } from 'pg';
import { getTokenFunction } from '../../azureAccountUtils';
import { getClientConfigs, testClientConfig, type PostgresClientConfigType } from '../getClientConfig';
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, timeoutErrorType } from '../postgresConstants';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';

export const postgresResourceType = 'https://ossrdbms-aad.database.windows.net/';

/**
 * Creates an object that can be used to execute a postgres query with connection test and telemetry.
 */
export class PostgresClientConfigFactory {
    public static async getClientConfigFromNode(
        treeItem: PostgresServerTreeItem,
        databaseName: string,
    ): Promise<{
        type: 'azureAd' | 'password' | 'connectionString';
        clientConfig: ClientConfig;
    }> {
        const parsedConnectionString = await treeItem.getFullConnectionString();

        let hasSubscription: boolean = false;
        let azureUserId: string | undefined = undefined;
        let tokenFunction: (() => Promise<string>) | undefined = undefined;
        try {
            const subscription = treeItem.subscription as ISubscriptionContext & AzureSubscription;
            const session = await subscription.authentication.getSession();
            if (session) {
                hasSubscription = true;
                azureUserId = session?.account.label;
                tokenFunction = getTokenFunction(subscription.credentials, postgresResourceType);
            } else {
                hasSubscription = false;
            }
        } catch {
            hasSubscription = false;
        }
        const clientConfigs = await getClientConfigs(
            parsedConnectionString,
            treeItem.serverType,
            hasSubscription,
            databaseName,
            azureUserId,
            tokenFunction,
        );

        const clientConfigTypeOrder: PostgresClientConfigType[] = ['azureAd', 'password', 'connectionString'];

        for (const clientConfigType of clientConfigTypeOrder) {
            const clientConfig: ClientConfig | undefined = clientConfigs[clientConfigType];
            if (!clientConfig) {
                continue;
            }

            try {
                await callWithTelemetryAndErrorHandling<void>('postgreSQL.testClientConfig', async (context) => {
                    context.errorHandling.rethrow = true;
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.clientConfigType = clientConfigType;
                    await testClientConfig(clientConfig);
                });
                return {
                    type: clientConfigType,
                    clientConfig,
                };
            } catch (error) {
                const parsedError = parseError(error);
                if (parsedError.errorType === invalidCredentialsErrorType) {
                    // If the client config failed with invalid credential error, skip and try the next available one.
                } else if (
                    parsedError.errorType === firewallNotConfiguredErrorType ||
                    parsedError.errorType === timeoutErrorType
                ) {
                    // The time out error are common when the firewall rules doesn't grant access from the current IP address.
                    // If the client is blocked by the firewall, let the user go to Azure Portal to grant access.
                    const publicIp = PostgresServerTreeItem.ipAddr;
                    let ipMessage: string;
                    if (publicIp !== undefined) {
                        ipMessage = l10n.t("The IP address '{0}' already exists in the firewall rules.", publicIp);
                    } else {
                        // The code should never reach here but handle it just in case.
                        ipMessage = l10n.t('Your IP address is already in the firewall rules.');
                    }
                    const configureFirewallMessage = l10n.t(
                        'Some network environments may not report the actual public-facing IP address needed to access your server. Contact your network administrator to add the actual IP address to the firewall rules.',
                    );
                    // eslint-disable-next-line @typescript-eslint/only-throw-error
                    throw {
                        message: `${ipMessage} ${configureFirewallMessage}`,
                        code: firewallNotConfiguredErrorType,
                    };
                } else {
                    throw error;
                }
            }
        }

        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw {
            message: l10n.t('Must enter credentials to connect to server.'),
            code: invalidCredentialsErrorType,
        };
    }
}
