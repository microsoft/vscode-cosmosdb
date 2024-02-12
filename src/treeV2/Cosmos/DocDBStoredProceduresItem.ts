/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, DatabaseDefinition, Resource } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DocDBConnection } from "./DocDBElement";
import { DocDBStoredProcedureItem } from "./DocDBStoredProcedureItem";
import { joinNodeId } from "./util";

export class DocDBStoredProceduresItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBStoredProceduresGroup";

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
        return joinNodeId(this.parent.id, "$StoredProcedures");
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: "StoredProcedures",
            id: this.id,
            iconPath: new vscode.ThemeIcon("server-process"),
            contextValue: DocDBStoredProceduresItem.contextValue,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        };
    }

    public async getChildren(): Promise<TreeElementBase[]> {
        const client = this.connection.getCosmosClient();
        const result = await client.database(this.database.id).container(this.container.id).scripts.storedProcedures.readAll().fetchAll();

        return result.resources.map((storedProcedure) => new DocDBStoredProcedureItem(this, this.database, this.container, storedProcedure, this.connection));
    }
}
