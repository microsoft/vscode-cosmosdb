/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DialogResponses, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { getPublicIpv4 } from '../../utils/getIp';
import { nonNullProp } from '../../utils/nonNull';
import { randomUtils } from '../../utils/randomUtils';
import { createAbstractPostgresClient, type AbstractPostgresClient } from '../abstract/AbstractPostgresClient';
import { type AbstractFirewallRule, type PostgresServerType } from '../abstract/models';
import { type PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';

export async function configurePostgresFirewall(
    context: IActionContext,
    treeItem?: PostgresServerTreeItem,
): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.rgApi.pickAppResource<PostgresServerTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
        });
    }

    const ip: string = await getPublicIp(context);
    await context.ui.showWarningMessage(
        vscode.l10n.t(
            'A firewall rule for your IP {0} will be added to server "{1}". Would you like to continue?',
            ip,
            treeItem.label,
        ),
        {
            modal: true,
            stepName: 'postgresAddFirewallRule',
        },
        { title: DialogResponses.yes.title },
    );

    await setFirewallRule(context, treeItem, ip);
}

export async function setFirewallRule(
    context: IActionContext,
    treeItem: PostgresServerTreeItem,
    ip: string,
): Promise<void> {
    const serverType: PostgresServerType = nonNullProp(treeItem, 'serverType');
    const client: AbstractPostgresClient = await createAbstractPostgresClient(serverType, [
        context,
        treeItem.subscription,
    ]);
    const resourceGroup: string = nonNullProp(treeItem, 'resourceGroup');
    const serverName: string = nonNullProp(treeItem, 'azureName');

    const firewallRuleName: string = 'azDbVSCode-Ip' + `-${randomUtils.getRandomHexString(6)}`;

    const newFirewallRule: AbstractFirewallRule = {
        startIpAddress: ip,
        endIpAddress: ip,
    };

    const progressMessage: string = vscode.l10n.t(
        'Adding firewall rule for IP "{0}" to server "{1}"...',
        ip,
        serverName,
    );
    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: progressMessage,
    };
    ext.outputChannel.appendLog(progressMessage);
    await vscode.window.withProgress(options, async () => {
        await client.firewallRules.beginCreateOrUpdateAndWait(
            resourceGroup,
            serverName,
            firewallRuleName,
            newFirewallRule,
        );
    });
    const completedMessage: string = vscode.l10n.t(
        'Successfully added firewall rule for IP "{0}" to server "{1}".',
        ip,
        serverName,
    );
    void vscode.window.showInformationMessage(completedMessage);
    ext.outputChannel.appendLog(completedMessage);
    await treeItem.refresh(context);
}

export async function getPublicIp(context: IActionContext): Promise<string> {
    return await getPublicIpv4(context);
}
