/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureParentNode, IAzureNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";

export class MongoFindOneResultEditor implements ICosmosEditor<IMongoDocument> {
    private _databaseNode: IAzureParentNode<MongoDatabaseTreeItem>;
    private _collectionName: string;
    private _originalDocument: IMongoDocument;

    constructor(databaseNode: IAzureParentNode<MongoDatabaseTreeItem>, collectionName: string, data: string) {
        this._databaseNode = databaseNode;
        this._collectionName = collectionName;
        this._originalDocument = JSON.parse(data);
    }

    public get label(): string {
        const accountNode = this._databaseNode.parent;
        return `${accountNode.treeItem.label}/${this._databaseNode.treeItem.label}/${this._collectionName}/${this._originalDocument._id}`;
    }

    public async getData(): Promise<IMongoDocument> {
        return this._originalDocument;
    }

    public async update(newDocument: IMongoDocument): Promise<IMongoDocument> {
        const cachedCollectionNodes = <IAzureParentNode<MongoCollectionTreeItem>[]>await this._databaseNode.getCachedChildren();
        const cachedCollectionNode = cachedCollectionNodes.find((node) => node.treeItem.label === this._collectionName);
        if (cachedCollectionNode) {
            const cachedDocumentNodes = <IAzureNode<MongoDocumentTreeItem>[]>await cachedCollectionNode.getCachedChildren();
            const cachedDocumentNode = cachedDocumentNodes.find((node) => node.treeItem.document._id.toString() === newDocument._id.toString());
            if (cachedDocumentNode) {
                return cachedDocumentNode.treeItem.update(newDocument);
            }
        }

        // If the node isn't cached already, just update it to Mongo directly (without worrying about updating the tree)
        const db = await this._databaseNode.treeItem.getDb();
        return await MongoDocumentTreeItem.update(db.collection(this._collectionName), newDocument);
    }

    public get id(): string {
        return `${this._databaseNode.id}/${this._collectionName}/${this._originalDocument._id.toString()}`;
    }

}
