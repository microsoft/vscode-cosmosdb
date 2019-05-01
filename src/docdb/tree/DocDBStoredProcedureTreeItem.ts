/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcedureMeta } from 'documentdb';
import * as path from 'path';
import * as vscode from "vscode";
import { AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { getResourcesPath } from '../../constants';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem extends AzureTreeItem<IDocDBTreeRoot> {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openStoredProcedure';

    constructor(parent: DocDBStoredProceduresTreeItem, public procedure: ProcedureMeta) {
        super(parent);
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
        const client = this.root.getDocumentClient();
        this.procedure = await new Promise<ProcedureMeta>((resolve, reject) => client.replaceStoredProcedure(
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
            light: path.join(getResourcesPath(), 'icons', 'light', 'Process_16x.svg'),
            dark: path.join(getResourcesPath(), 'icons', 'dark', 'Process_16x.svg')
        };
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete stored procedure '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this.root.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteStoredProcedure(this.link, err => err ? reject(err) : resolve());
            });
        } else {
            throw new UserCancelledError();
        }
    }
}
