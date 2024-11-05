/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, type IActionContext, type IParsedError } from '@microsoft/vscode-azext-utils';
import { type ClientConfig } from 'pg';
import { invalidCredentialsErrorType } from '../postgresConstants';
import { PostgresClientConfigFactory } from '../tree/ClientConfigFactory';
import { type PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { configurePostgresFirewall } from './configurePostgresFirewall';
import { enterPostgresCredentials } from './enterPostgresCredentials';

export async function checkAuthentication(
    context: IActionContext,
    treeItem: PostgresDatabaseTreeItem,
): Promise<ClientConfig> {
    let clientConfig: ClientConfig | undefined;
    while (!clientConfig) {
        const isFirewallRuleSet = await treeItem.parentServer.isFirewallRuleSet(context);
        if (!isFirewallRuleSet) {
            await configurePostgresFirewall(context, treeItem.parentServer);
            continue;
        }
        try {
            const getClientConfigResult = await PostgresClientConfigFactory.getClientConfigFromNode(
                treeItem.parentServer,
                treeItem.databaseName,
            );
            clientConfig = getClientConfigResult.clientConfig;
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                await enterPostgresCredentials(context, treeItem.parentServer);
            } else {
                throw error;
            }
        }
    }
    return clientConfig;
}
