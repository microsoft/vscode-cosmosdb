/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, DatabaseDefinition, Resource } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DocDBDocumentsItem } from "./DocDBDocumentsItem";
import { DocDBConnection } from "./DocDBElement";
import { DocDBStoredProceduresItem } from "./DocDBStoredProceduresItem";
import { joinNodeId } from "./util";

export class DocDBCollectionItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBDocumentCollection";

    public parent: TreeElementWithId;
    public database: DatabaseDefinition & Resource;
    public container: ContainerDefinition & Resource;
    public connection: DocDBConnection;

    public documentsItem: DocDBDocumentsItem;
    public storedProceduresItem: DocDBStoredProceduresItem;

    constructor(
        parent: TreeElementWithId,
        database: DatabaseDefinition & Resource,
        container: ContainerDefinition & Resource,
        connection: DocDBConnection
    ) {
        this.parent = parent;
        this.database = database;
        this.container = container;
        this.connection = connection;
        this.documentsItem = new DocDBDocumentsItem(this, database, container, connection);
        this.storedProceduresItem = new DocDBStoredProceduresItem(this, database, container, connection);
    }

    public get id(): string {
        return joinNodeId(this.parent.id, this.container.id);
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: this.container.id,
            id: this.id,
            iconPath: new vscode.ThemeIcon("files"),
            contextValue: DocDBCollectionItem.contextValue,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
    }

    public async getChildren(): Promise<TreeElementBase[]> {
        return [
            this.documentsItem,
            this.storedProceduresItem
        ];
    }
}
