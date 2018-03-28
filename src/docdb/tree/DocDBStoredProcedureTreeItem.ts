/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from "vscode";
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { ProcedureMeta } from 'documentdb';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;

    constructor(private _procedure: ProcedureMeta) {
    }

    public get id(): string {
        return this._procedure.id;
    }

    public get label(): string {
        return this._procedure.id;
    }

    public get link(): string {
        return this._procedure._self;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'Process_16x.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Process_16x.svg')
        };
    }
}
