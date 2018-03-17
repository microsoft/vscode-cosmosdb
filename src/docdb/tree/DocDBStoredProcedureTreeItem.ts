/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { ProcedureMeta } from 'documentdb';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;
    //asdf public readonly commandId: string = 'cosmosDB.openDocument';

    constructor(/*asdf private _collection: DocDBCollectionTreeItemBase,*/ private _procedure: ProcedureMeta) {
    }

    public get id(): string {
        return this._procedure.id;
    }

    public get label(): string {
        return this._procedure.id;
    }

    public get link(): string {
        return this._procedure._self;
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'Process_16x.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Process_16x.svg')
        };
    }

    /*asdf
    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
        if (result === DialogBoxResponses.Yes) {
            const client = this._collection.getDocumentClient();
            const options = { partitionKey: this.partitionKeyValue }
            await new Promise((resolve, reject) => {
                client.deleteDocument(this.link, options, function (err) {
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
                client.replaceDocument(_self, newData,
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
    }*/
}
