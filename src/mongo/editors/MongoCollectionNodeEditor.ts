/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICosmosEditor } from "../../CosmosEditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
// tslint:disable:no-var-requires
const EJSON = require("mongodb-extended-json");

export class MongoCollectionNodeEditor implements ICosmosEditor<IMongoDocument[]> {
    private _collectionNode: MongoCollectionTreeItem;
    constructor(collectionNode: MongoCollectionTreeItem) {
        this._collectionNode = collectionNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._collectionNode);
    }

    public async getData(): Promise<IMongoDocument[]> {
        const children = <MongoDocumentTreeItem[]>await this._collectionNode.getCachedChildren();
        return children.map((child) => child.document);
    }

    public async update(documents: IMongoDocument[]): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionNode.update(documents);
        await MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, this._collectionNode);
        return updatedDocs;
    }

    public static async updateCachedDocNodes(updatedDocs: IMongoDocument[], collectionNode: MongoCollectionTreeItem): Promise<void> {
        const documentNodes = <MongoDocumentTreeItem[]>await collectionNode.getCachedChildren();
        for (const updatedDoc of updatedDocs) {
            const documentNode = documentNodes.find((node) => node.document._id.toString() === updatedDoc._id.toString());
            if (documentNode) {
                documentNode.document = updatedDoc;
                await documentNode.refresh();
            }
        }
    }

    public get id(): string {
        return this._collectionNode.fullId;
    }

    public convertFromString(data: string): IMongoDocument[] {
        return EJSON.parse(data);
    }

    public convertToString(data: IMongoDocument[]): string {
        return EJSON.stringify(data, null, 2);
    }

}
