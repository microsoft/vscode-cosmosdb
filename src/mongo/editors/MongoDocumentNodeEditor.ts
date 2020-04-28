/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditor } from "../../EditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { IMongoDocument, MongoDocumentTreeItem } from "../tree/MongoDocumentTreeItem";
// tslint:disable:no-var-requires no-require-imports
const EJSON = require("mongodb-extended-json");

export class MongoDocumentNodeEditor implements IEditor<IMongoDocument> {
    private _documentNode: MongoDocumentTreeItem;
    constructor(documentNode: MongoDocumentTreeItem) {
        this._documentNode = documentNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._documentNode);
    }

    public async getData(): Promise<IMongoDocument> {
        return this._documentNode.document;
    }

    public async update(document: IMongoDocument): Promise<IMongoDocument> {
        const updatedDoc = await this._documentNode.update(document);
        await this._documentNode.refresh();
        return updatedDoc;
    }

    public get id(): string {
        return this._documentNode.fullId;
    }

    public convertFromString(data: string): IMongoDocument {
        return EJSON.parse(data);
    }

    public convertToString(data: IMongoDocument): string {
        return EJSON.stringify(data, null, 2);
    }
}
