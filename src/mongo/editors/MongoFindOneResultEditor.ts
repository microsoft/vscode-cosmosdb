/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureParentNode, IAzureNode, AzureTreeDataProvider } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";

export class MongoFindOneResultEditor implements ICosmosEditor<IMongoDocument> {
    private _databaseNode: IAzureParentNode<MongoDatabaseTreeItem>;
    private _collectionName: string;
    private _originalDocument: IMongoDocument;
    private _tree: AzureTreeDataProvider;

    constructor(databaseNode: IAzureParentNode<MongoDatabaseTreeItem>, collectionName: string, data: string, tree: AzureTreeDataProvider) {
        this._databaseNode = databaseNode;
        this._collectionName = collectionName;
        this._originalDocument = JSON.parse(data);
        this._tree = tree;
    }

    public get label(): string {
        const accountNode = this._databaseNode.parent;
        return `${accountNode.treeItem.label}/${this._databaseNode.treeItem.label}/${this._collectionName}/${this._originalDocument._id}`;
    }

    public async getData(): Promise<IMongoDocument> {
        return this._originalDocument;
    }

    public async update(newDocument: IMongoDocument): Promise<IMongoDocument> {
        const node = await this._tree.findNode(this.id);
        if (node) {
            return (<IAzureNode<MongoDocumentTreeItem>>node).treeItem.update(newDocument);
        }
        // If the node isn't cached already, just update it to Mongo directly (without worrying about updating the tree)
        const db = await this._databaseNode.treeItem.getDb();
        return await MongoDocumentTreeItem.update(db.collection(this._collectionName), newDocument);
    }

    public get id(): string {
        return `${this._databaseNode.id}/${this._collectionName}/${this._originalDocument._id.toString()}`;
    }

}
