/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureParentNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { Collection } from "mongodb";
import { MongoCollectionNodeEditor } from "./MongoCollectionNodeEditor";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { MongoCommand } from "../MongoCommand";
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";

export class MongoFindResultEditor implements ICosmosEditor<IMongoDocument[]> {
    private _databaseNode: IAzureParentNode<MongoDatabaseTreeItem>;
    private _command: MongoCommand;
    private _collectionTreeItem: MongoCollectionTreeItem;

    constructor(databaseNode: IAzureParentNode<MongoDatabaseTreeItem>, command: MongoCommand) {
        this._databaseNode = databaseNode;
        this._command = command;
    }

    public get label(): string {
        const accountNode = this._databaseNode.parent;
        return `${accountNode.treeItem.label}/${this._databaseNode.treeItem.label}/${this._command.collection}`;
    }

    public async getData(): Promise<IMongoDocument[]> {
        const dbTreeItem: MongoDatabaseTreeItem = this._databaseNode.treeItem;
        const db = await dbTreeItem.getDb();
        const collection: Collection = db.collection(this._command.collection);
        // NOTE: Intentionally creating a _new_ tree item rather than searching for a cached node in the tree because
        // the executed 'find' command could have a filter or projection that is not handled by a cached tree node
        this._collectionTreeItem = new MongoCollectionTreeItem(collection, dbTreeItem.id, this._command.arguments);
        const documents: MongoDocumentTreeItem[] = <MongoDocumentTreeItem[]>await this._collectionTreeItem.loadMoreChildren(undefined, true);
        return documents.map((docTreeItem) => docTreeItem.document);
    }

    public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionTreeItem.update(documents);
        const cachedCollectionNodes = <IAzureParentNode<MongoCollectionTreeItem>[]>await this._databaseNode.getCachedChildren();
        const cachedCollectionNode = cachedCollectionNodes.find((node) => node.treeItem.id === this._collectionTreeItem.id);
        if (cachedCollectionNode) {
            MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, cachedCollectionNode);
        }

        return updatedDocs;
    }
}
