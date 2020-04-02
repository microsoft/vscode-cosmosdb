/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { azureUtils } from '../../utils/azureUtils';
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
}
