/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from "azure-arm-postgresql";
import { FirewallRule } from "azure-arm-postgresql/lib/models";
import * as publicIp from 'public-ip';
import * as vscode from 'vscode';
import { createAzureClient, DialogResponses, IActionContext, IAzureQuickPickItem } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { IPostgresWizardContext } from "../../tree/PostgresAccountWizard/IPostgresWizardContext";
import { azureUtils } from "../../utils/azureUtils";
import { localize } from "../../utils/localize";
import { nonNullProp } from "../../utils/nonNull";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";

export async function configurePostgresFirewall(context: IActionContext | IPostgresWizardContext, treeItem?: PostgresServerTreeItem, createMode?: boolean): Promise<string> {
    const ip: string = await publicIp.v4();
    if (!treeItem && createMode) {

        const yesPick: IAzureQuickPickItem<string> = { data: 'Yes', label: 'Yes' };
        const noPick: IAzureQuickPickItem<string> = { data: 'No', label: 'No' };
        const picks: IAzureQuickPickItem<string>[] = [yesPick, noPick];

        const wizardContext: IPostgresWizardContext = <IPostgresWizardContext>context;

        const result = await ext.ui.showQuickPick(picks, { placeHolder: `Would you like to add firewall rule for your IP ${ip} to this server?` });

        if (result.label === "Yes") {
            wizardContext.firewall = true;
        } else {
            wizardContext.firewall = false;
        }

        return result.label;

    } else if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    await ext.ui.showWarningMessage(
        localize('firewallRuleWillBeAdded', 'A firewall rule for your IP ({0}) will be added to server "{1}". Would you like to continue?', ip, treeItem.server.name),
        { modal: true },
        { title: DialogResponses.yes.title }
    );

    if (treeItem) {
        void setFirewallRule(treeItem);
    }

    return "";
}

export async function setFirewallRule(treeItem: PostgresServerTreeItem): Promise<void> {

    const ip: string = await publicIp.v4();
    const client: PostgreSQLManagementClient = createAzureClient(treeItem.root, PostgreSQLManagementClient);
    const resourceGroup: string = azureUtils.getResourceGroupFromId(treeItem.id);
    const serverName: string = nonNullProp(treeItem.server, 'name');
    const firewallRuleName: string = "azureDatabasesForVSCode-publicIp";

    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: localize('configuringFirewall', 'Adding firewall rule for IP "{0}" to server "{1}"...', ip, serverName)
    };

    const newFirewallRule: FirewallRule = {
        startIpAddress: ip,
        endIpAddress: ip
    };

    await vscode.window.withProgress(options, async () => {
        await client.firewallRules.createOrUpdate(resourceGroup, serverName, firewallRuleName, newFirewallRule);
    });

    vscode.window.showInformationMessage(`Successfully added firewall rule to server "${serverName}".`);

    await treeItem.refresh();
}
