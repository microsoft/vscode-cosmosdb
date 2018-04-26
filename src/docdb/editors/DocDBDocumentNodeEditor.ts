/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureNode } from "vscode-azureextensionui";
import { ICosmosEditor } from "../../CosmosEditorManager";
import { RetrievedDocument } from "documentdb";
import { DocDBDocumentTreeItem } from "../tree/DocDBDocumentTreeItem";
import { getNodeEditorLabel } from '../../utils/vscodeUtils';

export class DocDBDocumentNodeEditor implements ICosmosEditor<RetrievedDocument> {
    private _documentNode: IAzureNode<DocDBDocumentTreeItem>;
    constructor(documentNode: IAzureNode<DocDBDocumentTreeItem>) {
        this._documentNode = documentNode;
    }

    public get label(): string {
        return getNodeEditorLabel(this._documentNode);
    }

    public async getData(): Promise<RetrievedDocument> {
        return this._documentNode.treeItem.document;
    }

    public async update(document: RetrievedDocument): Promise<RetrievedDocument> {
        return await this._documentNode.treeItem.update(document);
    }

    public get id(): string {
        return this._documentNode.id;
    }

    public convertFromString(data: string): RetrievedDocument {
        return JSON.parse(data);
    }

    public convertToString(data: RetrievedDocument): string {
        return JSON.stringify(data, null, 2);
    }

}
