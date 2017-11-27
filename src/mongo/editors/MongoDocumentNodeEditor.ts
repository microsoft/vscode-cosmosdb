/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor } from "../../DocumentEditor";

export class MongoDocumentNodeEditor implements ICosmosEditor<IMongoDocument> {
    private _collectionNode: IAzureNode<MongoDocumentTreeItem>;
    constructor(collectionNode: IAzureNode<MongoDocumentTreeItem>) {
        this._collectionNode = collectionNode;
    }

    public get label(): string {
        const collectionNode = this._collectionNode.parent;
        const databaseNode = collectionNode.parent;
        const accountNode = databaseNode.parent;
        return `${accountNode.treeItem.label}/${databaseNode.treeItem.label}/${collectionNode.treeItem.label}/${this._collectionNode.treeItem.label}`;
    }

    public async getData(): Promise<IMongoDocument> {
        return this._collectionNode.treeItem.document;
    }

    public async update(document: IMongoDocument): Promise<IMongoDocument> {
        return await this._collectionNode.treeItem.update(document);
    }
}
