/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "vscode-azureextensionui";
import { IEditor } from "../../EditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { MongoCollectionTreeItem } from "../tree/MongoCollectionTreeItem";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
// tslint:disable:no-var-requires no-require-imports
const EJSON = require("mongodb-extended-json");

export class MongoCollectionNodeEditor implements IEditor<IMongoDocument[]> {
    private _collectionNode: MongoCollectionTreeItem;
    constructor(collectionNode: MongoCollectionTreeItem) {
        this._collectionNode = collectionNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._collectionNode);
    }

    public get id(): string {
        return this._collectionNode.fullId;
    }

    public static async updateCachedDocNodes(updatedDocs: IMongoDocument[], collectionNode: MongoCollectionTreeItem, context: IActionContext): Promise<void> {
        const documentNodes = <MongoDocumentTreeItem[]>await collectionNode.getCachedChildren(context);
        for (const updatedDoc of updatedDocs) {
            const documentNode = documentNodes.find((node) => node.document._id.toString() === updatedDoc._id.toString());
            if (documentNode) {
                documentNode.document = updatedDoc;
                await documentNode.refresh();
            }
        }
    }

    public async getData(context: IActionContext): Promise<IMongoDocument[]> {
        const children = <MongoDocumentTreeItem[]>await this._collectionNode.getCachedChildren(context);
        return children.map((child) => child.document);
    }

    public async update(documents: IMongoDocument[], context: IActionContext): Promise<IMongoDocument[]> {
        const updatedDocs = await this._collectionNode.update(documents);
        await MongoCollectionNodeEditor.updateCachedDocNodes(updatedDocs, this._collectionNode, context);
        return updatedDocs;
    }

    public convertFromString(data: string): IMongoDocument[] {
        return EJSON.parse(data);
    }

    public convertToString(data: IMongoDocument[]): string {
        return EJSON.stringify(data, null, 2);
    }
}
