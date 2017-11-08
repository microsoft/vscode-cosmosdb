/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as util from "./../util";
import { CosmosDBAccountNode } from './../nodes';
import { DocDBDatabaseNode, DocDBCollectionNode, DocDBDocumentNode, IDocDBDocumentSpec } from './nodes';
import { DocumentClient } from 'documentdb';
import { DocumentBase } from 'documentdb/lib';
import { CosmosDBExplorer } from './../explorer';
import { DialogBoxResponses } from '../constants'

export class DocDBCommands {
    public static async createDocDBDatabase(server: CosmosDBAccountNode, explorer: CosmosDBExplorer) {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: 'Database Name',
            validateInput: DocDBCommands.validateDatabaseName,
            ignoreFocusOut: true
        });
        if (databaseName) {
            const masterKey = await server.getPrimaryMasterKey();
            const endpoint = server.documentEndpoint;
            const client = new DocumentClient(endpoint, { masterKey: masterKey });
            await new Promise((resolve, reject) => {
                client.createDatabase({ id: databaseName }, (err, result) => {
                    if (err) {
                        reject(new Error(err.body));
                    }
                    else {
                        resolve(result);
                    }
                });
            });
            const databaseNode = new DocDBDatabaseNode(databaseName, await server.getPrimaryMasterKey(), server.documentEndpoint, server);
            explorer.refresh(server);
            DocDBCommands.createDocDBCollection(databaseNode, explorer);
        }
    }

    public static async createDocDBDocument(coll: DocDBCollectionNode, explorer: CosmosDBExplorer) {
        const masterKey = coll.db.getPrimaryMasterKey();
        const endpoint = coll.db.getEndpoint();
        const client = new DocumentClient(endpoint, { masterKey: masterKey });
        let docID = await vscode.window.showInputBox({
            placeHolder: "Enter a unique id",
            ignoreFocusOut: true
        });
        if (docID || docID === "") {
            docID = docID.trim();
            const newDoc = await new Promise((resolve, reject) => {
                client.createDocument(coll.getCollLink(), { 'id': docID }, (err, result) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(result);
                    }
                });
            });
            coll.addNewDocToCache(newDoc);
        }
        explorer.refresh(coll);
    }


    public static async createDocDBCollection(db: DocDBDatabaseNode, explorer: CosmosDBExplorer) {
        const collectionName = await vscode.window.showInputBox({
            placeHolder: 'Enter name of collection',
            ignoreFocusOut: true
        });
        if (collectionName) {
            const masterKey = await db.getPrimaryMasterKey();
            const endpoint = await db.getEndpoint();
            let partitionKey: string = await vscode.window.showInputBox({
                prompt: 'Partition Key',
                ignoreFocusOut: true,
                validateInput: DocDBCommands.validatePartitionKey
            });
            if (partitionKey) {
                if (partitionKey[0] != '/') {
                    partitionKey = '/' + partitionKey;
                }
                const throughput: number = Number(await vscode.window.showInputBox({
                    value: '10000',
                    ignoreFocusOut: true,
                    prompt: 'Initial throughput capacity, between 2500 and 100,000',
                    validateInput: this.validateThroughput
                }));
                if (throughput) {
                    const client = new DocumentClient(endpoint, { masterKey: masterKey });
                    const options = { offerThroughput: throughput };
                    const collectionDef = {
                        id: collectionName,
                        partitionKey: {
                            paths: [partitionKey],
                            kind: DocumentBase.PartitionKind.Hash
                        }
                    };
                    await new Promise((resolve, reject) => {
                        client.createCollection(db.getDbLink(), collectionDef, options, (err, result) => {
                            if (err) {
                                reject(new Error(err.body));
                            }
                            else {
                                resolve(result);
                            }
                        });
                    });
                    explorer.refresh(db);
                }
            }
        }
    }

    private static validateDatabaseName(name: string): string | undefined | null {
        if (name.length < 1 || name.length > 255) {
            return "Name has to be between 1 and 255 chars long";
        }
        return undefined;
    }

    private static validatePartitionKey(key: string): string | undefined | null {
        if (/^[#?\\]*$/.test(key)) {
            return "Cannot contain these characters - ?,#,\\, etc."
        }
        return null;
    }

    private static validateThroughput(input: string): string | undefined | null {
        try {
            const value = Number(input);
            if (value < 2500 || value > 100000) {
                return "Value needs to lie between 2500 and 100,000"
            }
        } catch (err) {
            return "Input must be a number"
        }
        return null;
    }

    public static async deleteDocDBDatabase(db: DocDBDatabaseNode, explorer: CosmosDBExplorer): Promise<void> {
        if (db) {
            const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete database '${db.label}' and its collections?`,
                DialogBoxResponses.Yes, DialogBoxResponses.No);
            if (confirmed === DialogBoxResponses.Yes) {
                const masterKey = await db.getPrimaryMasterKey();
                const endpoint = await db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                await new Promise((resolve, reject) => {
                    client.deleteDatabase(db.getDbLink(), function (err) {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(db.server);
            }
        }
    }
    public static async deleteDocDBCollection(coll: DocDBCollectionNode, explorer: CosmosDBExplorer): Promise<void> {
        if (coll) {
            const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete collection '${coll.label}'?`, DialogBoxResponses.Yes, DialogBoxResponses.No);
            if (confirmed === DialogBoxResponses.Yes) {
                const masterKey = await coll.db.getPrimaryMasterKey();
                const endpoint = await coll.db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                const collLink = coll.getCollLink();
                await new Promise((resolve, reject) => {
                    client.deleteCollection(collLink, (err) => {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(coll.db);
            }
        }
    }

    public static async deleteDocDBDocument(doc: DocDBDocumentNode, explorer: CosmosDBExplorer): Promise<void> {
        if (doc) {
            const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete document '${doc.label}'?`, DialogBoxResponses.Yes, DialogBoxResponses.No);
            if (confirmed === DialogBoxResponses.Yes) {
                const masterKey = await doc.collection.db.getPrimaryMasterKey();
                const endpoint = await doc.collection.db.getEndpoint();
                const client: DocumentClient = new DocumentClient(endpoint, { masterKey: masterKey });
                const docLink = doc.getDocLink();
                const options = { partitionKey: doc.partitionKeyValue || Object() }
                await new Promise((resolve, reject) => {
                    client.deleteDocument(docLink, options, (err) => {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(doc.collection);
            }
        }
    }
}