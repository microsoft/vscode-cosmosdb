/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditor } from "../../EditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { DocDBStoredProcedureTreeItem } from "../tree/DocDBStoredProcedureTreeItem";

export class DocDBStoredProcedureNodeEditor implements IEditor<string> {
    private _spNode: DocDBStoredProcedureTreeItem;
    constructor(spNode: DocDBStoredProcedureTreeItem) {
        this._spNode = spNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._spNode);
    }

    public async getData(): Promise<string> {
        return this._spNode.procedure.body;
    }

    public async update(document: string): Promise<string> {
        return await this._spNode.update(document);
    }

    public get id(): string {
        return this._spNode.fullId;
    }

    public convertFromString(data: string): string {
        return data;
    }

    public convertToString(data: string): string {
        return data;
    }

}
