/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICosmosEditor } from "../../CosmosEditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { IPostgresTable, PostgreSQLTableTreeItem } from "../tree/PostgreSQLTableTreeItem";

// tslint:disable:no-var-requires no-require-imports
const EJSON = require("mongodb-extended-json");

export class PostgreSQLTableNodeEditor implements ICosmosEditor<IPostgresTable> {
    private _documentNode: PostgreSQLTableTreeItem;
    constructor(documentNode: PostgreSQLTableTreeItem) {
        this._documentNode = documentNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._documentNode);
    }

    public async getData(): Promise<IPostgresTable> {
        return this._documentNode.document;
    }

    public async update(document: IPostgresTable): Promise<IPostgresTable> {
        const updatedDoc = await this._documentNode.update(document);
        await this._documentNode.refresh();
        return updatedDoc;
    }

    public get id(): string {
        return this._documentNode.fullId;
    }

    public convertFromString(data: string): IPostgresTable {
        return EJSON.parse(data);
    }

    public convertToString(data: IPostgresTable): string {
        return EJSON.stringify(data, null, 2);
    }
}
