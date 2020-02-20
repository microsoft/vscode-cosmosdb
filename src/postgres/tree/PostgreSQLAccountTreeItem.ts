/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { Client } from 'pg';
import pgStructure from 'pg-structure';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, AzureParentTreeItem, AzureTreeItem, ICreateChildImplContext, parseError } from 'vscode-azureextensionui';
import { getThemedIconPath, Links, testDb } from '../../constants';
import { ext } from '../../extensionVariables';
import { config } from '../config';
import { connectToPostgresClient } from '../connectToPostgresClient';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLDatabaseTreeItem } from './PostgreSQLDatabaseTreeItem';

export class PostgreSQLAccountTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "cosmosDBPostgresServer";
    public readonly contextValue: string = PostgreSQLAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;
    public readonly connectionString: string;

    private _root: IPostgreSQLTreeRoot;

    constructor(parent: AzureParentTreeItem, id: string, label: string, isEmulator: boolean, readonly databaseAccount?: DatabaseAccount) {
        super(parent);
        this.id = id;
        this.label = label;
        // this.connectionString = connectionString;
        this._root = Object.assign({}, parent.root, { isEmulator });
    }

    // overrides ISubscriptionContext with an object that also has Mongo info
    public get root(): IPostgreSQLTreeRoot {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemedIconPath('CosmosDBAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<IPostgreSQLTreeRoot>[]> {
        let postgresClient: Client | undefined;
        try {
            // let databases: IDatabaseInfo[];

            // if (!this.connectionString) {
            //     throw new Error('Missing connection string');
            // }

            // Azure MongoDB accounts need to have the name passed in for private endpoints
            postgresClient = await connectToPostgresClient();

            const databaseInConnectionString = config.database;
            // if (databaseInConnectionString && !this.root.isEmulator) { // emulator violates the connection string format
            //     // If the database is in the connection string, that's all we connect to (we might not even have permissions to list databases)
            //     databases = [{
            //         name: databaseInConnectionString,
            //         empty: false
            //     }];
            // } else {
            // https://mongodb.github.io/node-mongodb-native/3.1/api/index.html
            const db = await pgStructure(postgresClient);
            const postgresDB = new PostgreSQLDatabaseTreeItem(this, db.name);
            const databases = [postgresDB];
            // }
            return databases;
        } catch (error) {
            const message = parseError(error).message;
            if (this._root.isEmulator && message.includes("ECONNREFUSED")) {
                error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
            }
            throw error;
        }
        finally {
            if (postgresClient) {
                // grandfathered in
                // tslint:disable-next-line: no-floating-promises
                postgresClient.end();
            }
        }
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<PostgreSQLDatabaseTreeItem> {
        const databaseName = await ext.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: validateDatabaseName
        });
        context.showCreatingTreeItem(databaseName);

        return new PostgreSQLDatabaseTreeItem(this, databaseName);
    }

    // public isAncestorOfImpl(contextValue: string): boolean {
    //     switch (contextValue) {
    //         case MongoDatabaseTreeItem.contextValue:
    //         case MongoCollectionTreeItem.contextValue:
    //         case MongoDocumentTreeItem.contextValue:
    //             return true;
    //         default:
    //             return false;
    //     }
    // }

    // public async deleteTreeItemImpl(): Promise<void> {
    //     await deleteCosmosDBAccount(this);
    // }
}

function validateDatabaseName(database: string): string | undefined | null {
    // https://docs.mongodb.com/manual/reference/limits/#naming-restrictions
    const min = 1;
    const max = 63;
    if (!database || database.length < min || database.length > max) {
        return `Database name must be between ${min} and ${max} characters.`;
    }
    if (/[/\\. "$]/.test(database)) {
        return "Database name cannot contain these characters - `/\\. \"$`";
    }
    return undefined;
}

export interface IDatabaseInfo {
    name?: string;
    empty?: boolean;
}
