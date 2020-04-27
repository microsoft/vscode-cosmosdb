/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { FirewallRule } from 'azure-arm-postgresql/lib/models';
import * as publicIp from 'public-ip';
import * as vscode from 'vscode';
import { createAzureClient, DialogResponses, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { azureUtils } from "../../utils/azureUtils";
import { localize } from "../../utils/localize";
import { nonNullProp } from '../../utils/nonNull';
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";

export async function configurePostgresFirewall(context: IActionContext, treeItem?: PostgresServerTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    const ip: string = await publicIp.v4();
    await ext.ui.showWarningMessage(
        localize('firewallRuleWillBeAdded', 'A firewall rule for your IP ({0}) will be added to server "{1}". Would you like to continue?', ip, treeItem.server.name),
        { modal: true },
        { title: DialogResponses.yes.title }
    );

    await setFirewallRule(treeItem, ip);

}

export async function setFirewallRule(treeItem: PostgresServerTreeItem, ip: string): Promise<void> {

    const client: PostgreSQLManagementClient = createAzureClient(treeItem.root, PostgreSQLManagementClient);
    const resourceGroup: string = azureUtils.getResourceGroupFromId(treeItem.id);
    const serverName: string = nonNullProp(treeItem.server, 'name');
    const firewallRuleName: string = "azureDatabasesForVSCode-publicIp";

    const newFirewallRule: FirewallRule = {
        startIpAddress: ip,
        endIpAddress: ip
    };

    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: localize('configuringFirewall', 'Adding firewall rule for IP "{0}" to server "{1}"...', ip, serverName)
    };

    await vscode.window.withProgress(options, async () => {
        await client.firewallRules.createOrUpdate(resourceGroup, serverName, firewallRuleName, newFirewallRule);
    });

    await treeItem.refresh();
}
