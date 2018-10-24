/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Collection, CollectionMeta, DatabaseMeta, DocumentClient, FeedOptions, QueryIterator } from 'documentdb';
import { DocumentBase } from 'documentdb/lib';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

const minThroughputFixed = 400;
const minThroughputPartitioned = 1000;
const maxThroughput: number = 100000;

/**
 * This class provides common logic for DocumentDB, Graph, and Table databases
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBDatabaseTreeItemBase extends DocDBTreeItemBase<CollectionMeta> {
    private readonly _database: DatabaseMeta;
    public readonly parent: DocDBAccountTreeItemBase;

    constructor(parent: DocDBAccountTreeItemBase, database: DatabaseMeta) {
        super(parent);
        this._database = database;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg')
        };
    }

    public get id(): string {
        return this._database.id;
    }

    public get label(): string {
        return this._database.id;
    }

    public get link(): string {
        return this._database._self;
    }

    public get connectionString(): string {
        return this.parent.connectionString.concat(`;Database=${this.id}`);
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<CollectionMeta>> {
        return await client.readCollections(this.link, feedOptions);
    }

    // Delete the database
    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete database '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this.root.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteDatabase(this.link, err => err ? reject(err) : resolve());
            });
        } else {
            throw new UserCancelledError();
        }
    }

    // Create a DB collection
    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<AzureTreeItem<IDocDBTreeRoot>> {
        const collectionName = await ext.ui.showInputBox({
            placeHolder: `Enter an id for your ${this.childTypeLabel}`,
            ignoreFocusOut: true,
            validateInput: DocDBDatabaseTreeItemBase.validateCollectionName
        });

        let collectionDef: Collection = {
            id: collectionName
        };

        let partitionKey: string | undefined = await ext.ui.showInputBox({
            prompt: 'Enter the partition key for the collection, or leave blank for fixed size.',
            ignoreFocusOut: true,
            validateInput: DocDBDatabaseTreeItemBase.validatePartitionKey
        });

        if (partitionKey && partitionKey.length && partitionKey[0] !== '/') {
            partitionKey = '/' + partitionKey;
        }
        if (!partitionKey) {
            collectionDef.partitionKey = {
                paths: [partitionKey],
                kind: DocumentBase.PartitionKind.Hash
            };
        }
        const isFixed: boolean = !(collectionDef.partitionKey);
        const minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
        const throughput: number = Number(await ext.ui.showInputBox({
            value: minThroughput.toString(),
            ignoreFocusOut: true,
            prompt: `Initial throughput capacity, between ${minThroughput} and ${maxThroughput}`,
            validateInput: (input: string) => DocDBDatabaseTreeItemBase.validateThroughput(isFixed, input)
        }));

        const options = { offerThroughput: throughput };

        showCreatingTreeItem(collectionName);
        const client = this.root.getDocumentClient();
        const collection: CollectionMeta = await new Promise<CollectionMeta>((resolve, reject) => {
            client.createCollection(this.link, collectionDef, options, (err, result) => {
                err ? reject(err) : resolve(result);
            });
        });

        return this.initChild(collection);
    }

    private static validatePartitionKey(key: string): string | undefined | null {
        if (/[#?\\]/.test(key)) {
            return "Cannot contain these characters: ?,#,\\, etc.";
        }
        return undefined;
    }

    private static validateThroughput(isFixed: boolean, input: string): string | undefined | null {
        try {
            let minThroughput = isFixed ? minThroughputFixed : minThroughputPartitioned;
            const value = Number(input);
            if (value < minThroughput || value > maxThroughput) {
                return `Value must be between ${minThroughput} and ${maxThroughput}`;
            }
        } catch (err) {
            return "Input must be a number";
        }
        return undefined;
    }

    private static validateCollectionName(name: string): string | undefined | null {
        if (!name) {
            return "Collection name cannot be empty";
        }
        if (name.endsWith(" ")) {
            return "Collection name cannot end with space";
        }
        if (/[/\\?#]/.test(name)) {
            return `Collection name cannot contain the characters '\\', '/', '#', '?'`;
        }
        return undefined;
    }
}
