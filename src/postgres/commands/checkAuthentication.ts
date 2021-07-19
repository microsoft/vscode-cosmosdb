/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FirewallRuleListResult } from "@azure/arm-postgresql/esm/models";
import { ClientConfig } from "pg";
import { IActionContext, IParsedError, parseError } from "vscode-azureextensionui";
import { nonNullProp } from "../../utils/nonNull";
import { createAbstractPostgresClient } from "../abstract/AbstractPostgresClient";
import { PostgresServerType } from "../abstract/models";
import { getClientConfig } from "../getClientConfig";
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType, PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";
import { configurePostgresFirewall, getPublicIp } from "./configurePostgresFirewall";
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
            } else if (treeItem.parent.resourceGroup && parsedError.errorType === firewallNotConfiguredErrorType) {
                await configurePostgresFirewall(context, treeItem.parent);
            } else if (treeItem.parent.resourceGroup && parsedError.errorType === 'ETIMEDOUT' && !(await isFirewallRuleSet(treeItem.parent))) {
                await configurePostgresFirewall(context, treeItem.parent);
            } else {
                throw error;
            }
        }
    }
    return clientConfig;
}

export async function isFirewallRuleSet(treeItem: PostgresServerTreeItem): Promise<boolean> {
    const serverType: PostgresServerType = nonNullProp(treeItem, 'serverType');
    const client = createAbstractPostgresClient(serverType, treeItem.root);
    client.firewallRules.listByServer
    const result: FirewallRuleListResult = (await client.firewallRules.listByServer(nonNullProp(treeItem, 'resourceGroup'), nonNullProp(treeItem, 'azureName')))._response.parsedBody;
    return (result.some(async value => value.name === 'azureDatabasesForVSCode-publicIp' && value.startIpAddress === await getPublicIp()));
}

