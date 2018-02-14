/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor, EditableConfig } from "../../CosmosEditorManager";

export class MongoDocumentNodeEditor implements ICosmosEditor<IMongoDocument> {
    private _documentNode: IAzureNode<MongoDocumentTreeItem>;
    constructor(collectionNode: IAzureNode<MongoDocumentTreeItem>) {
        this._documentNode = collectionNode;
    }

    public get label(): string {
        const collectionNode = this._documentNode.parent;
        const databaseNode = collectionNode.parent;
        const accountNode = databaseNode.parent;
        const subscriptionNode = accountNode.parent;
        return `${subscriptionNode.treeItem.label}/${accountNode.treeItem.label}/${databaseNode.treeItem.label}/${collectionNode.treeItem.label}/${this._documentNode.treeItem.label}`;
    }

    public async getData(): Promise<IMongoDocument> {
        return this._documentNode.treeItem.document;
    }

    public async update(document: IMongoDocument): Promise<IMongoDocument> {
        return await this._documentNode.treeItem.update(document);
    }

    public get id(): EditableConfig {
        const subscriptionNode = this._documentNode.parent.parent.parent.parent;
        return { subscriptionName: subscriptionNode.treeItem.id, path: this._documentNode.treeItem.id };
    }
}
