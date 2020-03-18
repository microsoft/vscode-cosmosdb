/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, createAzureClient, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { azureUtils } from '../../utils/azureUtils';
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

    public get label(): string | undefined {
        return this.server.name;
    }

    public get description(): string | undefined {
        return "PostgreSQL";
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISubscriptionContext>[]> {
        const resourceGroup: string = azureUtils.getResourceGroupFromId(this.server.id);
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        let listOfDatabases: DatabaseListResult = await client.databases.listByServer(resourceGroup, this.server.name);
        listOfDatabases = listOfDatabases.filter(database => !['azure_maintenance', 'azure_sys'].includes(database.name));
        return listOfDatabases.map(database => new PostgresDatabaseTreeItem(this, database.name));
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
