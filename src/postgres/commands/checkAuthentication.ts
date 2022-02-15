/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IParsedError, parseError } from "@microsoft/vscode-azext-utils";
import { ClientConfig } from "pg";
import { getClientConfig } from "../getClientConfig";
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { enterPostgresCredentials } from "./enterPostgresCredentials";

export async function checkAuthentication(context: IActionContext, treeItem: PostgresDatabaseTreeItem): Promise<ClientConfig> {
    let clientConfig: ClientConfig | undefined;
    while (!clientConfig) {
        try {
            clientConfig = await getClientConfig(treeItem.parent, treeItem.databaseName);
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                await enterPostgresCredentials(context, treeItem.parent);

                // Need to configure firewall only for Azure Subscritption accounts
            } else if (treeItem.parent.resourceGroup && (parsedError.errorType === firewallNotConfiguredErrorType || (parsedError.errorType === 'ETIMEDOUT' && !(await treeItem.isFirewallRuleSet(context, treeItem.parent))))) {
                await configurePostgresFirewall(context, treeItem.parent);
            } else {
                throw error;
            }
        }
    }
    return clientConfig;
}
