/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { ICosmosEditor, EditableConfig } from "../../CosmosEditorManager";
import { RetrievedDocument } from "documentdb";
import { DocDBDocumentTreeItem } from "../tree/DocDBDocumentTreeItem";

export class DocDBDocumentNodeEditor implements ICosmosEditor<RetrievedDocument> {
    private _documentNode: IAzureNode<DocDBDocumentTreeItem>;
    constructor(documentNode: IAzureNode<DocDBDocumentTreeItem>) {
        this._documentNode = documentNode;
    }

    public get label(): string {
        const collectionNode = this._documentNode.parent;
        const databaseNode = collectionNode.parent;
        const accountNode = databaseNode.parent;
        return `${accountNode.treeItem.label}/${databaseNode.treeItem.label}/${collectionNode.treeItem.label}/${this._documentNode.treeItem.label}`;
    }

    public async getData(): Promise<RetrievedDocument> {
        return this._documentNode.treeItem.document;
    }

    public async update(document: RetrievedDocument): Promise<RetrievedDocument> {
        return await this._documentNode.treeItem.update(document);
    }

    public get id(): EditableConfig {
        const subscriptionNode = this._documentNode.parent.parent.parent.parent;
        return { subscriptionName: subscriptionNode.treeItem.id, path: this._documentNode.treeItem.id };
    }

}
