/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, DatabaseDefinition, ItemDefinition, Resource } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { TreeItem } from "vscode";
import { ext } from "../../extensionVariables";
import { DocDBConnection } from "./DocDBElement";
import { joinNodeId } from "./util";

export class DocDBDocumentItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBDocument";

    public parent: TreeElementWithId;
    public database: DatabaseDefinition & Resource;
    public container: ContainerDefinition & Resource;
    public document: ItemDefinition;
    public connection: DocDBConnection;

    constructor(
        parent: TreeElementWithId,
        database: DatabaseDefinition & Resource,
        container: ContainerDefinition & Resource,
        document: ItemDefinition,
        connection: DocDBConnection
    ) {
        this.parent = parent;
        this.database = database;
        this.container = container;
        this.document = document;
        this.connection = connection;
    }

    public get id(): string {
        const documentId = this._getId();
        return joinNodeId(this.parent.id, documentId);
    }

    public async getTreeItem(): Promise<TreeItem> {
        return {
            label: this._getLabel(),
            id: this._getId(),
            iconPath: new vscode.ThemeIcon("file"),
            contextValue: DocDBDocumentItem.contextValue
        };
    }

    private _getLabel(): string {
        const documentLabelFields = vscode.workspace.getConfiguration().get<string[]>(ext.settingsKeys.documentLabelFields) ?? [];
        for (const field of documentLabelFields) {
            if (this.document.hasOwnProperty(field)) {
                const value = this.document[field];
                if (value !== undefined && typeof value !== "object") {
                    return value.toString();
                }
            }
        }
        return this.document.id?.toString() ?? "";
    }

    private _getId(): string {
        const partitionKey = this.container.partitionKey;
        if (!partitionKey) {
            // Fixed collections don't have partition key
            return this.document.id ?? "";
        } else {
            const fields = partitionKey.paths[0].split('/');
            if (fields[0] === '') {
                fields.shift();
            }
            let value;
            for (const field of fields) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                value = value ? value[field] : this.document[field];
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return `${this.document.id}:${value}`;
        }
    }
}
