/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import { Databases } from 'azure-arm-postgresql/lib/operations';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ClientConfigClass } from '../ClientConfigClass';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';

export class PostgreSQLAccountTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "cosmosDBPostgresServer";
    public readonly contextValue: string = PostgreSQLAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;
    public readonly connectionString: string;
    public readonly clientConfig: ClientConfigClass;
    public readonly host: string;
    public readonly databases: Databases;

    private _root: IPostgreSQLTreeRoot;

    constructor(parent: AzureParentTreeItem, id: string, label: string, readonly server: Server, databases: Databases, readonly resourceGroup: string, connectionString?: string) {
        super(parent);
        this.id = id;
        this.label = label;
        this.host = server.fullyQualifiedDomainName;
        this.databases = databases;
        this.resourceGroup = resourceGroup;
        if (connectionString) {
            this.connectionString = connectionString;
        }
    }

    // overrides ISubscriptionContext with an object that also has Mongo info
    public get root(): IPostgreSQLTreeRoot {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgreSQLAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<IPostgreSQLTreeRoot>[]> {
        const listOfDatabases: DatabaseListResult = await this.databases.listByServer(this.resourceGroup, this.server.name);
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
