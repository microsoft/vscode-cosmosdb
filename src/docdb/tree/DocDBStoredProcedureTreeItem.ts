/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient, ProcedureMeta } from 'documentdb';
import * as path from 'path';
import * as vscode from "vscode";
import { DialogResponses, IAzureNode, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { getDocumentClient } from '../getDocumentClient';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openStoredProcedure';

    constructor(private _endpoint: string, private _masterKey: string, private _isEmulator: boolean, private _client: DocumentClient, public procedure: ProcedureMeta) {
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

    public async update(newProcBody: string): Promise<string> {
        this.procedure = await new Promise<ProcedureMeta>((resolve, reject) => this._client.replaceStoredProcedure(
            this.link,
            { body: newProcBody, id: this.procedure.id },
            (err, updated: ProcedureMeta) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(updated);
                }
            })
        );
        return newProcBody;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'Process_16x.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'Process_16x.svg')
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete stored procedure '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = getDocumentClient(this._endpoint, this._masterKey, this._isEmulator);
            await new Promise((resolve, reject) => {
                // tslint:disable-next-line:no-function-expression // Grandfathered in
                client.deleteStoredProcedure(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }
}
