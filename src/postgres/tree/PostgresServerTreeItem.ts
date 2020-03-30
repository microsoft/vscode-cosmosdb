/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { DatabaseListResult, FirewallRule, Server } from 'azure-arm-postgresql/lib/models';
import * as publicIp from 'public-ip';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, ISubscriptionContext, parseError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresSchemaTreeItem } from './PostgresSchemaTreeItem';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresServerTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresServer";
    public readonly contextValue: string = PostgresServerTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly server: Server;

    constructor(parent: AzureParentTreeItem, server: Server) {
        super(parent);
        this.server = server;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresServer.svg');
    }

    public get label(): string {
        return this.name;
    }

    public get name(): string {
        return nonNullProp(this.server, 'name');
    }

    public get id(): string {
        return nonNullProp(this.server, 'id');
    }

    public get description(): string | undefined {
        return "PostgreSQL";
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const resourceGroup: string = azureUtils.getResourceGroupFromId(this.id);
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const listOfDatabases: DatabaseListResult = await client.databases.listByServer(resourceGroup, this.name);
        return this.createTreeItemsWithErrorHandling(
            listOfDatabases,
            'invalidPostgresServer',
            (database) => {
                return database.name && !['azure_maintenance', 'azure_sys'].includes(database.name) ? new PostgresDatabaseTreeItem(this, database.name) : undefined;
            },
            (database) => database.name
        );
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgresDatabaseTreeItem.contextValue:
            case PostgresSchemaTreeItem.contextValue:
            case PostgresTableTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }

    public async checkAndConfigureFirewall(): Promise<void> {
        const firewallRuleName: string = 'azureDatabasesForVSCode-publicIp';
        const resourceGroup: string = azureUtils.getResourceGroupFromId(this.id);
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const serverName: string = nonNullProp(this.server, 'name');
        const ip: string = await publicIp.v4();
        let existingFirewallRule: FirewallRule | undefined;

        // Creating/updating a firewall rule takes a long time. So check if the rule already exists and is valid before creating/updating
        try {
            existingFirewallRule = await client.firewallRules.get(resourceGroup, serverName, firewallRuleName);
        } catch (error) {
            if (parseError(error).errorType === 'ResourceNotFound') {
                // This firewall rule is not configured yet. Ignore error
            } else {
                throw error;
            }
        }

        if (!existingFirewallRule || existingFirewallRule.startIpAddress !== ip || existingFirewallRule.endIpAddress !== ip) {
            await ext.ui.showWarningMessage(
                localize('firewallWillBeConfigured', 'The firewall for server "{0}" will be configured to allow your IP ({1}).', this.server.name, ip),
                { modal: true },
                { title: localize('continue', 'Continue') }
            );

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
        }
    }
}
