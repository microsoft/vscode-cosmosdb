/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { MongoClient, Db } from 'mongodb';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { MongoDatabaseTreeItem, validateMongoCollectionName } from './MongoDatabaseTreeItem';

export class MongoAccountTreeItem implements IAzureParentTreeItem {
    public static contextValue: string = "cosmosDBMongoServer";
    public readonly contextValue: string = MongoAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly id: string;
    public readonly label: string;

    public readonly connectionString: string;

    constructor(id: string, label: string, connectionString: string) {
        this.id = id;
        this.label = label;
        this.connectionString = connectionString;
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'CosmosDBAccount.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'CosmosDBAccount.svg')
        };
    }

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(_node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
        let db: Db | undefined;
        try {
            db = await MongoClient.connect(this.connectionString);
            const result: { databases: IDatabaseInfo[] } = await db.admin().listDatabases();
            return result.databases
                .filter((database: IDatabaseInfo) => !(database.name && database.name.toLowerCase() === "admin" && database.empty)) // Filter out the 'admin' database if it's empty
                .map(database => new MongoDatabaseTreeItem(database.name, this.connectionString, this.id));
        } catch (error) {
            return [{
                id: 'cosmosMongoError',
                contextValue: 'cosmosMongoError',
                label: error.message,
            }];
        } finally {
            if (db) {
                db.close();
            }
        }
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: validateDatabaseName,
        });
        if (databaseName) {
            const collectionName = await vscode.window.showInputBox({
                placeHolder: 'Collection Name',
                prompt: 'A collection is required to create a database',
                ignoreFocusOut: true,
                validateInput: validateMongoCollectionName
            });
            if (collectionName) {
                showCreatingNode(databaseName);

                const databaseTreeItem = new MongoDatabaseTreeItem(databaseName, this.connectionString, this.id);
                await databaseTreeItem.createCollection(collectionName);
                return databaseTreeItem;
            }
        }

        throw new UserCancelledError();
    }

}

function validateDatabaseName(database: string): string | undefined | null {
    // https://docs.mongodb.com/manual/reference/limits/#naming-restrictions
    const min = 1;
    const max = 63;
    if (!database || database.length < min || database.length > max) {
        return `Database name must be between ${min} and ${max} characters.`;
    }
    if (/[/\\. "$]/.test(database)) {
        return "Database name cannot contain these characters - `/\\. \"$`"
    }
    return undefined;
}

interface IDatabaseInfo {
    name?: string;
    empty?: boolean;
}
