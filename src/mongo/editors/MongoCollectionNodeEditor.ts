/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureParentNode, IAzureNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";

export class MongoCollectionNodeEditor implements ICosmosEditor<IMongoDocument[]> {
    private _collectionNode: IAzureParentNode<MongoCollectionTreeItem>;
    constructor(collectionNode: IAzureParentNode<MongoCollectionTreeItem>) {
        this._collectionNode = collectionNode;
    }

    public get label(): string {
        const databaseNode = this._collectionNode.parent;
        const accountNode = databaseNode.parent;
        return `${accountNode.treeItem.label}/${databaseNode.treeItem.label}/${this._collectionNode.treeItem.label}`;
    }

    public async getData(): Promise<IMongoDocument[]> {
        const children = <IAzureNode<MongoDocumentTreeItem>[]>await this._collectionNode.getCachedChildren();
        return children.map((child) => child.treeItem.document);
    }

    public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionNode.treeItem.update(documents);
        await MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, this._collectionNode);
        return updatedDocs;
    }

    public static async updateCachedDocNodes(updatedDocs: IMongoDocument[], collectionNode: IAzureParentNode<MongoCollectionTreeItem>): Promise<void> {
        const documentNodes = <IAzureNode<MongoDocumentTreeItem>[]>await collectionNode.getCachedChildren();
        for (const updatedDoc of updatedDocs) {
            const documentNode = documentNodes.find((node) => node.treeItem.document._id.toString() === updatedDoc._id.toString());
            if (documentNode) {
                documentNode.treeItem.document = updatedDoc;
            }
        }
    }
}
