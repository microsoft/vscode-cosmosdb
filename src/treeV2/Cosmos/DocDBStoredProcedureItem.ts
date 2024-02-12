/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, DatabaseDefinition, Resource, StoredProcedureDefinition } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { DocDBConnection } from "./DocDBElement";
import { joinNodeId } from "./util";

export class DocDBStoredProcedureItem implements TreeElementBase {
    public static contextValue: string = "cosmosDBStoredProcedure";

    public parent: TreeElementWithId;
    public database: DatabaseDefinition & Resource;
    public container: ContainerDefinition & Resource;
    public storedProcedure: StoredProcedureDefinition & Resource;
    public connection: DocDBConnection;

    constructor(
        parent: TreeElementWithId,
        database: DatabaseDefinition & Resource,
        container: ContainerDefinition & Resource,
        storedProcedure: StoredProcedureDefinition & Resource,
        connection: DocDBConnection
    ) {
        this.parent = parent;
        this.database = database;
        this.container = container;
        this.storedProcedure = storedProcedure;
        this.connection = connection;
    }

    public get id(): string {
        return joinNodeId(this.parent.id, this.storedProcedure.id);
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: this.storedProcedure.id,
            id: this.storedProcedure.id,
            iconPath: new vscode.ThemeIcon("server-process"),
            contextValue: DocDBStoredProcedureItem.contextValue
        };
    }
}
