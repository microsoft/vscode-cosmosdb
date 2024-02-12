/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseDefinition, Resource } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DocDBCollectionItem } from "./DocDBCollectionItem";
import { DocDBConnection } from "./DocDBElement";
import { joinNodeId } from "./util";

export class DocDBDatabaseItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBDocumentDatabase";

    public parent: TreeElementWithId;
    public database: DatabaseDefinition & Resource;
    public connection: DocDBConnection;

    constructor(
        parent: TreeElementWithId,
        database: DatabaseDefinition & Resource,
        connection: DocDBConnection
    ) {
        this.parent = parent;
        this.database = database;
        this.connection = connection;
    }

    public get id(): string {
        return joinNodeId(this.parent.id, this.database.id);
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: this.database.id,
            id: this.id,
            iconPath: new vscode.ThemeIcon("database"),
            contextValue: DocDBDatabaseItem.contextValue,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
    }

    public async getChildren(): Promise<TreeElementBase[]> {
        const client = this.connection.getCosmosClient();
        const result = await client.database(this.database.id).containers.readAll().fetchAll();
        return result.resources.map((container) => new DocDBCollectionItem(this, this.database, container, this.connection));
    }
}
