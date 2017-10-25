/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as util from "./../util";
import { CosmosDBResourceNode } from './../nodes';
import { DocDBDatabaseNode, DocDBCollectionNode, DocDBDocumentNode, IDocDBDocumentSpec } from './nodes';
import { DocumentClient } from 'documentdb';
import { DocumentBase } from 'documentdb/lib';
import { CosmosDBExplorer } from './../explorer';

export class DocDBCommands {
    public static async createDocDBDatabase(server: CosmosDBResourceNode, explorer: CosmosDBExplorer) {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: 'Database Name',
            validateInput: DocDBCommands.validateDatabaseName,
            ignoreFocusOut: true
        });
        if (databaseName) {
            const masterKey = await server.getPrimaryMasterKey();
            const endpoint = await server.getEndpoint();
            const client = new DocumentClient(endpoint, { masterKey: masterKey });
            await new Promise((resolve, reject) => {
                client.createDatabase({ id: databaseName }, (err, result) => {
                    if (err) {
                        reject(err.body);
                    }
                    else {
                        resolve(result);
                    }
                });
            });
            const databaseNode = new DocDBDatabaseNode(databaseName, await server.getPrimaryMasterKey(), await server.getEndpoint(), server.defaultExperience, server);
            explorer.refresh(server);
            DocDBCommands.createDocDBCollection(databaseNode, explorer);
        }
    }

    public static async createDocDBDocument(coll: DocDBCollectionNode, explorer: CosmosDBExplorer) {
        const masterKey = coll.db.getPrimaryMasterKey();
        const endpoint = coll.db.getEndpoint();
        const client = new DocumentClient(endpoint, { masterKey: masterKey });
        const docid = await vscode.window.showInputBox({
            placeHolder: "Enter a unique id",
            ignoreFocusOut: true
        });
        await new Promise((resolve, reject) => {
            client.createDocument(coll.getCollLink(), { 'id': docid }, (err, result) => {
                if (err) {
                    reject(err.body);
                }
                else {
                    resolve(result);
                }
            });
        });
        explorer.refresh(coll);
    }


    public static async createDocDBCollection(db: DocDBDatabaseNode, explorer: CosmosDBExplorer) {
        const collectionName = await vscode.window.showInputBox({
            placeHolder: 'Collection Name',
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
                                reject(err.body);
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
                "Yes", "No");
            if (confirmed === "Yes") {
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
            const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete collection '${coll.label}'?`, "Yes", "No");
            if (confirmed === "Yes") {
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
            const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete document '${doc.label}'?`, "Yes", "No");
            if (confirmed === "Yes") {
                const masterKey = await doc.collection.db.getPrimaryMasterKey();
                const endpoint = await doc.collection.db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                const docLink = doc.getDocLink();
                await new Promise((resolve, reject) => {
                    client.deleteDocument(docLink, (err) => {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(doc.collection);
            }
        }
    }

    public static async updateDocDBDocument(document: DocDBDocumentNode): Promise<void> {
        //get the data from the editor
        const masterKey = await document.collection.db.getPrimaryMasterKey();
        const endpoint = await document.collection.db.getEndpoint();
        const client = new DocumentClient(endpoint, { masterKey: masterKey });
        const editor = vscode.window.activeTextEditor;
        const newDocument = JSON.parse(editor.document.getText());
        const docLink = document.data._self;
        const updated = await new Promise<IDocDBDocumentSpec>((resolve, reject) => {
            client.replaceDocument(docLink, newDocument,
                { accessCondition: { type: 'IfMatch', condition: newDocument._etag } },
                (err, updated) => {
                    if (err) {
                        reject(new Error(err.body));
                    }
                    else {
                        resolve(updated);
                    }
                });
        });
        document.data = updated;
        await util.showResult(JSON.stringify(updated, null, 2), 'cosmos-document.json');
    }
}