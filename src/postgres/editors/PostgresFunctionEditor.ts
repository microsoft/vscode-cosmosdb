/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from "pg";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { getNodeEditorLabel } from "../../utils/vscodeUtils";
import { PostgresFunctionTreeItem } from "../tree/PostgresFunctionTreeItem";

export class PostgresFunctionEditor implements ICosmosEditor<string> {
    private _treeItem: PostgresFunctionTreeItem;

    constructor(treeItem: PostgresFunctionTreeItem) {
        this._treeItem = treeItem;
    }

    public get label(): string {
        return getNodeEditorLabel(this._treeItem);
    }

    public async getData(): Promise<string> {
        return this._treeItem.definition;
    }

    public async update(newDefinition: string): Promise<string> {
        this._treeItem.definition = newDefinition;
        const client = new Client(this._treeItem.parent.clientConfig);
        await client.connect();
        await client.query(this._treeItem.definition);
        return this._treeItem.definition;
    }

    public get id(): string {
        return this._treeItem.fullId;
    }

    public convertFromString(data: string): string {
        return data;
    }

    public convertToString(data: string): string {
        return data;
    }
}
