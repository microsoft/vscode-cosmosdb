/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, DatabaseDefinition, Resource } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DocDBDocumentItem } from "./DocDBDocumentItem";
import { DocDBConnection } from "./DocDBElement";
import { joinNodeId } from "./util";

export class DocDBDocumentsItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBDocumentsGroup";

    public parent: TreeElementWithId;
    public database: DatabaseDefinition & Resource;
    public container: ContainerDefinition & Resource;
    public connection: DocDBConnection;

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
    }

    public get id(): string {
        return joinNodeId(this.parent.id, "$Documents");
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: "Documents",
            id: this.id,
            iconPath: new vscode.ThemeIcon("files"),
            contextValue: DocDBDocumentsItem.contextValue,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
    }

    public async getChildren(): Promise<TreeElementBase[]> {
        const client = this.connection.getCosmosClient();
        const result = await client.database(this.database.id).container(this.container.id).items.readAll().fetchAll();

        return result.resources.map((document) => new DocDBDocumentItem(this, this.database, this.container, document, this.connection));
    }
}
