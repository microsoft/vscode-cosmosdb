/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as publicIp from 'public-ip';
import * as vscode from 'vscode';
import { DialogResponses, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { nonNullProp } from '../../utils/nonNull';
import { createAbstractPostgresClient } from '../abstract/AbstractPostgresClient';
import { AbstractFirewallRule, PostgresServerType } from '../abstract/models';
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";

export async function configurePostgresFirewall(context: IActionContext, treeItem?: PostgresServerTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    const ip: string = await getPublicIp();
    await context.ui.showWarningMessage(
        localize('firewallRuleWillBeAdded', 'A firewall rule for your IP ({0}) will be added to server "{1}". Would you like to continue?', ip, treeItem.label),
        {
            modal: true,
            stepName: 'postgresAddFirewallRule'
        },
        { title: DialogResponses.yes.title }
    );

    await setFirewallRule(context, treeItem, ip);
}

export async function setFirewallRule(context: IActionContext, treeItem: PostgresServerTreeItem, ip: string): Promise<void> {

    const serverType: PostgresServerType = nonNullProp(treeItem, 'serverType');
    const client = createAbstractPostgresClient(serverType, treeItem.root);
    const resourceGroup: string = nonNullProp(treeItem, 'resourceGroup');
    const serverName: string = nonNullProp(treeItem, 'azureName');

    const hashCode = s => s.split('').reduce((a, b) => (((a << 5) - a) + b.charCodeAt(0)) | 0, 0);
    const firewallRuleName: string = "azureDatabasesForVSCode-publicIp" + hashCode(ip);

    const newFirewallRule: AbstractFirewallRule = {
        startIpAddress: ip,
        endIpAddress: ip
    };

    const progressMessage: string = localize('configuringFirewallRule', 'Adding firewall rule for IP "{0}" to server "{1}"...', ip, serverName);
    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: progressMessage
    };
    ext.outputChannel.appendLog(progressMessage);
    await vscode.window.withProgress(options, async () => {
        await client.firewallRules.createOrUpdate(resourceGroup, serverName, firewallRuleName, newFirewallRule);
    });
    const completedMessage: string = localize('addedFirewallRule', 'Successfully added firewall rule for IP "{0}" to server "{1}".', ip, serverName);
    void vscode.window.showInformationMessage(completedMessage);
    ext.outputChannel.appendLog(completedMessage);
    await treeItem.refresh(context);
}

export async function getPublicIp(): Promise<string> {
    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: localize('gettingPublicIp', 'Getting public IP...')
    };

    return await vscode.window.withProgress(options, async () => {
        return await publicIp.v4();
    });
}
