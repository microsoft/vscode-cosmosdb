/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, IParsedError, parseError } from "@microsoft/vscode-azext-utils";
import { ClientConfig } from "pg";
import { invalidCredentialsErrorType } from "../postgresConstants";
import { PostgresClientConfigFactory } from "../tree/ClientConfigFactory";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { enterPostgresCredentials } from "./enterPostgresCredentials";

export async function checkAuthentication(context: IActionContext, treeItem: PostgresDatabaseTreeItem): Promise<ClientConfig> {
    let clientConfig: ClientConfig | undefined;
    while (!clientConfig) {
        const isFirewallRuleSet = await treeItem.parent.isFirewallRuleSet(context);
        if (!isFirewallRuleSet) {
            await configurePostgresFirewall(context, treeItem.parent);
            continue;
        }
        try {
            clientConfig = await PostgresClientConfigFactory.getClientConfigFromNode(treeItem.parent, treeItem.databaseName);
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                await enterPostgresCredentials(context, treeItem.parent);
            } else {
                throw error;
            }
        }
    }
    return clientConfig;
}
