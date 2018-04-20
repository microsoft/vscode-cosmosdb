/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';
import { DocDBStoredProcedureTreeItem } from "../tree/DocDBStoredProcedureTreeItem";

export class DocDBStoredProcedureNodeEditor implements ICosmosEditor<string> {
    private _spNode: IAzureNode<DocDBStoredProcedureTreeItem>;
    constructor(spNode: IAzureNode<DocDBStoredProcedureTreeItem>) {
        this._spNode = spNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._spNode);
    }

    public async getData(): Promise<string> {
        return this._spNode.treeItem.procedure.body;
    }

    public async update(document: string): Promise<string> {
        return await this._spNode.treeItem.update(document);
    }

    public get id(): string {
        return this._spNode.id;
    }

    public convertData(data: string): string {
        return data;
    }

    public convertToString(data: string): string {
        return data;
    }

}
