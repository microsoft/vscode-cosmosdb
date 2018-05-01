/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { IAzureNode, IAzureTreeItem, UserCancelledError, DialogResponses } from 'vscode-azureextensionui';
import { RetrievedDocument, DocumentClient } from 'documentdb';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';

/**
 * Represents a Cosmos DB DocumentDB (SQL) document
 */
export class DocDBDocumentTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBDocument";
    public readonly contextValue: string = DocDBDocumentTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openDocument';

    public readonly partitionKeyValue: string;

    private _document: RetrievedDocument;
    private _collection: DocDBCollectionTreeItem;

    constructor(collection: DocDBCollectionTreeItem, document: RetrievedDocument) {
        this._collection = collection;
        this._document = document;
        this.partitionKeyValue = this.getPartitionKeyValue();
    }

    public get id(): string {
        return this.document.id;
    }

    public get label(): string {
        return this.document.id;
    }

    public get link(): string {
        return this.document._self;
    }

    get document(): RetrievedDocument {
        return this._document;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Document.svg'),
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this._collection.getDocumentClient();
            const options = { partitionKey: this.partitionKeyValue || {} }
            await new Promise((resolve, reject) => {
                // Disabling type check in the next line. This helps ensure documents having no partition key value
                // can still pass an empty object. It looks like a disparity between the type settings  out lined
                // https://github.com/DefinitelyTyped/DefinitelyTyped/blob/01e0ffdbab16b15c702d5b8c87bb122cc6215a59/types/documentdb/index.d.ts#L72
                // and the workaround outlined at https://github.com/Azure/azure-documentdb-node/issues/222#issuecomment-364286027
                // tslint:disable-next-line:no-any
                client.deleteDocument(this.link, <any>options, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }

    public async update(newData: RetrievedDocument): Promise<RetrievedDocument> {
        const client: DocumentClient = this._collection.getDocumentClient();
        const _self: string = this.document._self;
        if (["_self", "_etag"].some((element) => !newData[element])) {
            throw new Error(`The "_self" and "_etag" fields are required to update a document`);
        }
        else {
            this._document = await new Promise<RetrievedDocument>((resolve, reject) => {
                client.replaceDocument(
                    _self,
                    newData,
                    { accessCondition: { type: 'IfMatch', condition: newData._etag }, partitionKey: this.partitionKeyValue },
                    (err, updated: RetrievedDocument) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(updated);
                        }
                    });
            });
            return this.document;
        }
    }

    private getPartitionKeyValue(): string | undefined {
        const partitionKey = this._collection.partitionKey;
        if (!partitionKey) {
            return undefined;
        }
        const fields = partitionKey.paths[0].split('/');
        if (fields[0] === '') {
            fields.shift();
        }
        let value;
        for (let field of fields) {
            value = value ? value[field] : this.document[field];
            if (!value) {
                break;
            }
        }
        return value;
    }
}
