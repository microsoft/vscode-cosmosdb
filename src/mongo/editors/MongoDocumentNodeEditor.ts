/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';

export class MongoDocumentNodeEditor implements ICosmosEditor<IMongoDocument> {
    private _documentNode: IAzureNode<MongoDocumentTreeItem>;
    constructor(collectionNode: IAzureNode<MongoDocumentTreeItem>) {
        this._documentNode = collectionNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._documentNode);
    }

    public async getData(): Promise<IMongoDocument> {
        return this._documentNode.treeItem.document;
    }

    public async update(document: IMongoDocument): Promise<IMongoDocument> {
        return await this._documentNode.treeItem.update(document);
    }

    public get id(): string {
        return this._documentNode.id;
    }

    public convertFromString(data: string): IMongoDocument {
        return JSON.parse(data);
    }

    public convertToString(data: IMongoDocument): string {
        return JSON.stringify(data, null, 2);
    }
}
