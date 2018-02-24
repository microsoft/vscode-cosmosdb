/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RetrievedDocument } from 'documentdb';
import { IAzureNode, UserCancelledError, IAzureTreeItem } from 'vscode-azureextensionui';
import * as vscode from 'vscode';
import { DocDBCollectionTreeItemBase } from './DocDBCollectionTreeItemBase';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';

export class DocDBCollectionTreeItem extends DocDBCollectionTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentCollection";
    public readonly contextValue: string = DocDBCollectionTreeItem.contextValue;
    public readonly childTypeLabel: string = "Document";

    public initChild(document: RetrievedDocument): IAzureTreeItem {
        return new DocDBDocumentTreeItem(this, document);
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const client = this.getDocumentClient();
        let docID = await vscode.window.showInputBox({
            placeHolder: "Enter a unique id",
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
