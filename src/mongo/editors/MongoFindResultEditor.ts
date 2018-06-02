/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureParentNode, AzureTreeDataProvider } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { Collection } from "mongodb";
import { MongoCollectionNodeEditor } from "./MongoCollectionNodeEditor";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { MongoCommand } from "../MongoCommand";
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";
// tslint:disable:no-var-requires
const EJSON = require("mongodb-extended-json");

export class MongoFindResultEditor implements ICosmosEditor<IMongoDocument[]> {
    private _databaseNode: IAzureParentNode<MongoDatabaseTreeItem>;
    private _command: MongoCommand;
    private _collectionTreeItem: MongoCollectionTreeItem;
    private _tree: AzureTreeDataProvider;

    constructor(databaseNode: IAzureParentNode<MongoDatabaseTreeItem>, command: MongoCommand, tree: AzureTreeDataProvider) {
        this._databaseNode = databaseNode;
        this._command = command;
        this._tree = tree;
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
        this._collectionTreeItem = new MongoCollectionTreeItem(collection, this._command.arguments);
        const documents: MongoDocumentTreeItem[] = <MongoDocumentTreeItem[]>await this._collectionTreeItem.loadMoreChildren(undefined, true);
        return documents.map((docTreeItem) => docTreeItem.document);
    }

    public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionTreeItem.update(documents);
        const cachedCollectionNode = await this._tree.findNode(this.id);
        if (cachedCollectionNode) {
            await MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, <IAzureParentNode<MongoCollectionTreeItem>>cachedCollectionNode);
        }
        return updatedDocs;
    }

    public get id(): string {
        return `${this._databaseNode.id}/${this._command.collection}`;
    }

    public convertFromString(data: string): IMongoDocument[] {
        return EJSON.parse(data);
    }

    public convertToString(data: IMongoDocument[]): string {
        return EJSON.stringify(data, null, 2);
    }

}
