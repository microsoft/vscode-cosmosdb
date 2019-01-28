/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { DatabaseMeta, DocumentClient, FeedOptions, QueryIterator } from 'documentdb';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { deleteCosmosDBAccount } from '../../commands/deleteCosmosDBAccount';
import { resourcesPath } from '../../constants';
import { rejectOnTimeout } from '../../utils/timeout';
import { getDocumentClient } from '../getDocumentClient';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * This class provides common logic for DocumentDB, Graph, and Table accounts
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBAccountTreeItemBase extends DocDBTreeItemBase<DatabaseMeta> {
    public readonly id: string;
    public readonly label: string;
    public readonly childTypeLabel: string = "Database";

    private _root: IDocDBTreeRoot;

    constructor(parent: AzureParentTreeItem, id: string, label: string, documentEndpoint: string, masterKey: string, isEmulator: boolean, readonly databaseAccount?: DatabaseAccount) {
        super(parent);
        this.id = id;
        this.label = label;
        this._root = Object.assign({}, parent.root, {
            documentEndpoint,
            masterKey,
            isEmulator,
            getDocumentClient: () => getDocumentClient(documentEndpoint, masterKey, isEmulator)
        });
    }

    // overrides ISubscriptionRoot with an object that also has DocDB info
    public get root(): IDocDBTreeRoot {
        return this._root;
    }

    public get connectionString(): string {
        return `AccountEndpoint=${this.root.documentEndpoint};AccountKey=${this.root.masterKey}`;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(resourcesPath, 'icons', 'light', 'CosmosDBAccount.svg'),
            dark: path.join(resourcesPath, 'icons', 'dark', 'CosmosDBAccount.svg')
        };
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<DatabaseMeta>> {
        return await client.readDatabases(feedOptions);
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<AzureTreeItem<IDocDBTreeRoot>> {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: 'Database Name',
            validateInput: DocDBAccountTreeItemBase.validateDatabaseName,
            ignoreFocusOut: true
        });

        if (databaseName) {
            showCreatingTreeItem(databaseName);
            const client = this.root.getDocumentClient();
            const database: DatabaseMeta = await new Promise<DatabaseMeta>((resolve, reject) => {
                client.createDatabase({ id: databaseName }, (err, db: DatabaseMeta) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(db);
                    }
                });
            });

            return this.initChild(database);
        }

        throw new UserCancelledError();
    }

    public async loadMoreChildrenImpl(clearCache: boolean) {
        if (this._root.isEmulator) {
            let unableToReachEmulatorMessage: string = "Unable to reach emulator. Please ensure it is started and connected to the port specified by the 'cosmosDB.emulator.port' setting, then try again.";
            return await rejectOnTimeout(2000, () => super.loadMoreChildrenImpl(clearCache), unableToReachEmulatorMessage);
        } else {
            return await super.loadMoreChildrenImpl(clearCache);
        }
    }

    private static validateDatabaseName(name: string): string | undefined | null {
        if (!name || name.length < 1 || name.length > 255) {
            return "Name has to be between 1 and 255 chars long";
        }
        if (name.endsWith(" ")) {
            return "Database name cannot end with space";
        }
        if (/[/\\?#]/.test(name)) {
            return `Database name cannot contain the characters '\\', '/', '#', '?'`;
        }
        return undefined;
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await deleteCosmosDBAccount(this);
    }
}
