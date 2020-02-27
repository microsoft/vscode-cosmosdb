/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Database, Server } from 'azure-arm-postgresql/lib/models';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, parseError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath, Links } from '../../constants';
import { ClientConfigClass } from '../ClientConfigClass';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';
// import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';
// import { PostgreSQLTableTreeItem } from './PostgreSQLTableTreeItem';

export class PostgreSQLAccountTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "cosmosDBPostgresServer";
    public readonly contextValue: string = PostgreSQLAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;
    public readonly connectionString: string;
    public readonly clientConfig: ClientConfigClass;
    public readonly host: string;

    private _root: IPostgreSQLTreeRoot;

    constructor(parent: AzureParentTreeItem, id: string, label: string, isEmulator: boolean, readonly databaseAccount?: Server, readonly databases?: Database[], connectionString?: string) {
        super(parent);
        this.id = id;
        this.label = label;
        if (isEmulator) {
            this.connectionString = connectionString;
        }
        this._root = Object.assign({}, parent.root, { isEmulator });
        this.host = databaseAccount.fullyQualifiedDomainName;
    }

    // overrides ISubscriptionContext with an object that also has Mongo info
    public get root(): IPostgreSQLTreeRoot {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('CosmosDBAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<IPostgreSQLTreeRoot>[]> {
        // let postgresClient: Client | undefined;
        try {
            const databases = this.databases.filter(database => !['azure_maintenance', 'azure_sys'].includes(database.name));
            return databases.map(database => new PostgreSQLDatabaseTreeItem(this, database.name, this.host));
        } catch (error) {
            const message = parseError(error).message;
            if (this._root.isEmulator && message.includes("ECONNREFUSED")) {
                error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
            }
            throw error;
        }
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgreSQLDatabaseTreeItem.contextValue:
                // case PostgreSQLSchemaTreeItem.contextValue:
                // case PostgreSQLTableTreeItem.contextValue:
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
