/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { DocumentClient, QueryIterator, FeedOptions, RetrievedDocument, DocumentOptions } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IAzureTreeItem, UserCancelledError, IAzureNode } from 'vscode-azureextensionui';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';

// NOTE: This node not used until viewing/editor stored procedures is implemented

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

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
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
            prompt: "Enter a unique document ID or leave blank for a generated ID",
            ignoreFocusOut: true
        });

        if (docID || docID === "") {
            docID = docID.trim();
            let body = { 'id': docID };
            const partitionKey: string | undefined = this._collection.partitionKey && this._collection.partitionKey.paths[0];
            if (partitionKey) {
                const partitionKeyValue: string = await vscode.window.showInputBox({
                    prompt: `The partition key is ${partitionKey}. Enter a value for the partition key`,
                    ignoreFocusOut: true
                });
                // Cannot pass a partition key value during document creation.
                // Need to have the partitionKey value as part of the document contents
                Object.assign(body, this.createPartitionPathObject(partitionKey, partitionKeyValue));
            }
            showCreatingNode(docID);
            const document: RetrievedDocument = await new Promise<RetrievedDocument>((resolve, reject) => {
                client.createDocument(this.link, body, (err, result: RetrievedDocument) => {
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

    // Create a nested Object given the partition key path and value
    private createPartitionPathObject(partitionKey, partitionKeyValue): Object {
        //remove leading slash
        partitionKey = partitionKey.slice(1);
        let path = partitionKey.split('/');
        let PartitionPath: Object = {};
        let interim: Object = PartitionPath;
        let i: number;
        for (i = 0; i < path.length - 1; i++) {
            interim[path[i]] = {};
            interim = interim[path[i]];
        }
        interim[path[i]] = partitionKeyValue;
        return PartitionPath;
    }
}
