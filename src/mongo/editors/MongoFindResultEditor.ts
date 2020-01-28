/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Collection } from "mongodb";
import { IActionContext } from "vscode-azureextensionui";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { ext } from "../../extensionVariables";
import { MongoCommand } from "../MongoCommand";
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "../tree/MongoDatabaseTreeItem";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { MongoCollectionNodeEditor } from "./MongoCollectionNodeEditor";
// tslint:disable:no-var-requires no-require-imports
const EJSON = require("mongodb-extended-json");

export class MongoFindResultEditor implements ICosmosEditor<IMongoDocument[]> {
    private _databaseNode: MongoDatabaseTreeItem;
    private _command: MongoCommand;
    private _collectionTreeItem: MongoCollectionTreeItem;

    constructor(databaseNode: MongoDatabaseTreeItem, command: MongoCommand) {
        this._databaseNode = databaseNode;
        this._command = command;
    }

    public get label(): string {
        const accountNode = this._databaseNode.parent;
        return `${accountNode.label}/${this._databaseNode.label}/${this._command.collection}`;
    }

    public async getData(context: IActionContext): Promise<IMongoDocument[]> {
        const db = await this._databaseNode.connectToDb();
        const collection: Collection = db.collection(this._command.collection);
        // NOTE: Intentionally creating a _new_ tree item rather than searching for a cached node in the tree because
        // the executed 'find' command could have a filter or projection that is not handled by a cached tree node
        this._collectionTreeItem = new MongoCollectionTreeItem(this._databaseNode, collection, this._command.argumentObjects);
        const documents: MongoDocumentTreeItem[] = <MongoDocumentTreeItem[]>await this._collectionTreeItem.getCachedChildren(context);
        return documents.map((docTreeItem) => docTreeItem.document);
    }

    public async update(documents: IMongoDocument[], context: IActionContext): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionTreeItem.update(documents);
        const cachedCollectionNode = await ext.tree.findTreeItem(this.id, context);
        if (cachedCollectionNode) {
            await MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, <MongoCollectionTreeItem>cachedCollectionNode, context);
        }
        return updatedDocs;
    }

    public get id(): string {
        return `${this._databaseNode.fullId}/${this._command.collection}`;
    }

    public convertFromString(data: string): IMongoDocument[] {
        return EJSON.parse(data);
    }

    public convertToString(data: IMongoDocument[]): string {
        return EJSON.stringify(data, null, 2);
    }

}
