/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from "vscode";
import { IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { ProcedureMeta } from 'documentdb';
import { DialogBoxResponses } from '../../constants';
import { getDocumentClient } from '../getDocumentClient';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openStoredProcedure';

    constructor(private _endpoint: string, private _masterKey: string, private _isEmulator: boolean, public procedure: ProcedureMeta) {
    }

    public get id(): string {
        return this.procedure.id;
    }

    public get label(): string {
        return this.procedure.id;
    }

    public get link(): string {
        return this.procedure._self;
    }

    public async update(newProc: string): Promise<string> {
        return newProc;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'Process_16x.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Process_16x.svg')
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete stored procedure '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
        if (result === DialogBoxResponses.Yes) {
            const client = getDocumentClient(this._endpoint, this._masterKey, this._isEmulator);
            await new Promise((resolve, reject) => {
                client.deleteStoredProcedure(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }
}
