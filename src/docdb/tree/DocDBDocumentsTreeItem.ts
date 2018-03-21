/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { DocumentClient, QueryIterator, FeedOptions, RetrievedDocument } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IAzureTreeItem, UserCancelledError, IAzureNode } from 'vscode-azureextensionui';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';

/**
 * This class provides logic for DocumentDB collections
 */
export class DocDBDocumentsTreeItem extends DocDBTreeItemBase<RetrievedDocument> {
    public static contextValue: string = "cosmosDBDocumentsGroup";
    public readonly contextValue: string = DocDBDocumentsTreeItem.contextValue;
    public readonly childTypeLabel: string = "Documents";

    constructor(documentEndpoint: string, masterKey: string, private _collection: DocDBCollectionTreeItem, isEmulator: boolean) {
        super(documentEndpoint, masterKey, isEmulator);
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg')
        };
    }

    public get id(): string {
        return "$Documents";
    }

    public get label(): string {
        return "Documents";
    }

    public get link(): string {
        return this._collection.link;
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<RetrievedDocument>> {
        return await client.readDocuments(this.link, feedOptions);
    }

    public initChild(document: RetrievedDocument): IAzureTreeItem {
        return new DocDBDocumentTreeItem(this._collection, document);
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const client = this.getDocumentClient();
        let docID = await vscode.window.showInputBox({
            placeHolder: "Enter a unique document id",
            ignoreFocusOut: true
        });

        if (docID || docID === "") {
            docID = docID.trim();
            showCreatingNode(docID);
            const document: RetrievedDocument = await new Promise<RetrievedDocument>((resolve, reject) => {
                client.createDocument(this.link, { 'id': docID }, (err, result: RetrievedDocument) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });

            return this.initChild(document);
        }

        throw new UserCancelledError();
    }
}
