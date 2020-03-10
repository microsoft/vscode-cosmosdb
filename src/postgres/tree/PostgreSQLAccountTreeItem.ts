/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import { Databases } from 'azure-arm-postgresql/lib/operations';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';

export class PostgreSQLAccountTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "cosmosDBPostgresServer";
    public readonly contextValue: string = PostgreSQLAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;
    public readonly connectionString: string;
    public readonly host: string;
    public readonly databases: Databases;

    constructor(parent: AzureParentTreeItem, label: string, readonly account: Server, databases: Databases, readonly resourceGroup: string, connectionString?: string) {
        super(parent);
        this.id = account.id;
        this.label = label;
        this.host = account.fullyQualifiedDomainName;
        this.databases = databases;
        this.resourceGroup = resourceGroup;
        if (connectionString) {
            this.connectionString = connectionString;
        }
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgreSQLAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISubscriptionContext>[]> {
        const listOfDatabases: DatabaseListResult = await this.databases.listByServer(this.resourceGroup, this.account.name);
        const databases = listOfDatabases.filter(database => !['azure_maintenance', 'azure_sys'].includes(database.name));
        return databases.map(database => new PostgreSQLDatabaseTreeItem(this, database.name, this.host));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgreSQLDatabaseTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }
}

export interface IDatabaseInfo {
    name?: string;
    empty?: boolean;
}
