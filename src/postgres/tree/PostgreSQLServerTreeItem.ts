/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import { Databases } from 'azure-arm-postgresql/lib/operations';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { azureUtils } from '../../utils/azureUtils';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';
import { PostgreSQLTableTreeItem } from './PostgreSQLTableTreeItem';

export class PostgreSQLServerTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresServer";
    public readonly contextValue: string = PostgreSQLServerTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly client: PostgreSQLManagementClient;
    public readonly databases: Databases;
    public readonly label: string;
    public readonly server: Server;

    constructor(parent: AzureParentTreeItem, client: PostgreSQLManagementClient, server: Server) {
        super(parent);
        this.client = client;
        this.server = server;
        this.label = server.name + ` (Postgres)`;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgreSQLAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISubscriptionContext>[]> {
        const resourceGroup: string = azureUtils.getResourceGroupFromId(this.server.id);
        let listOfDatabases: DatabaseListResult = await this.client.databases.listByServer(resourceGroup, this.server.name);
        listOfDatabases = listOfDatabases.filter(database => !['azure_maintenance', 'azure_sys'].includes(database.name));
        return listOfDatabases.map(database => new PostgreSQLDatabaseTreeItem(this, database.name));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgreSQLDatabaseTreeItem.contextValue:
            case PostgreSQLSchemaTreeItem.contextValue:
            case PostgreSQLTableTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }
}
