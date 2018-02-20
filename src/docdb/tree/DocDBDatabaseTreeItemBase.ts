/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentClient, QueryIterator, DatabaseMeta, CollectionMeta, FeedOptions } from 'documentdb';
import { IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import * as vscode from 'vscode';
import { DocumentBase } from 'documentdb/lib';
import { DialogBoxResponses } from '../../constants';

const minThroughput: number = 1000;
const maxThroughput: number = 100000;

/**
 * This class provides common logic for DocumentDB, Graph, and Table databases
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBDatabaseTreeItemBase extends DocDBTreeItemBase<CollectionMeta> {
    private readonly _database: DatabaseMeta;
    private readonly _parentId: string;

    constructor(documentEndpoint: string, masterKey: string, database: DatabaseMeta, parentId: string, isEmulator: boolean) {
        super(documentEndpoint, masterKey, isEmulator);
        this._database = database;
        this._parentId = parentId;
    }

    public get iconPath(): any {
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

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<CollectionMeta>> {
        return await client.readCollections(this.link, feedOptions);
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete database '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
        if (result === DialogBoxResponses.Yes) {
            const client = this.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteDatabase(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const collectionName = await vscode.window.showInputBox({
            placeHolder: `Enter a name for your ${this.childTypeLabel}`,
            ignoreFocusOut: true,
            validateInput: DocDBDatabaseTreeItemBase.validateCollectionName
        });

        if (collectionName) {
            let partitionKey: string | undefined = await vscode.window.showInputBox({
                prompt: 'Partition Key',
                ignoreFocusOut: true,
                validateInput: DocDBDatabaseTreeItemBase.validatePartitionKey
            });

            if (partitionKey) {
                if (partitionKey[0] != '/') {
                    partitionKey = '/' + partitionKey;
                }
                const throughput: number = Number(await vscode.window.showInputBox({
                    value: minThroughput.toString(),
                    ignoreFocusOut: true,
                    prompt: `Initial throughput capacity, between ${minThroughput} and ${maxThroughput}`,
                    validateInput: DocDBDatabaseTreeItemBase.validateThroughput
                }));

                if (throughput) {
                    const options = { offerThroughput: throughput };
                    const collectionDef = {
                        id: collectionName,
                        partitionKey: {
                            paths: [partitionKey],
                            kind: DocumentBase.PartitionKind.Hash
                        }
                    };

                    showCreatingNode(collectionName);
                    const client = this.getDocumentClient();
                    const collection: CollectionMeta = await new Promise<CollectionMeta>((resolve, reject) => {
                        client.createCollection(this.link, collectionDef, options, (err, result) => {
                            err ? reject(err) : resolve(result);
                        });
                    });

                    return this.initChild(collection);
                }
            }
        }

        throw new UserCancelledError();
    }

    private static validatePartitionKey(key: string): string | undefined | null {
        if (/^[#?\\]*$/.test(key)) {
            return "Cannot contain these characters - ?,#,\\, etc."
        }
        return undefined;
    }

    private static validateThroughput(input: string): string | undefined | null {
        try {
            const value = Number(input);
            if (value < minThroughput || value > maxThroughput) {
                return `Value must be between ${minThroughput} and ${maxThroughput}`
            }
        } catch (err) {
            return "Input must be a number"
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
