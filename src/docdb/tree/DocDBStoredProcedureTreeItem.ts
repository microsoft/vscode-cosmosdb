/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProcedureMeta } from 'documentdb';
import * as vscode from "vscode";
import { AzureTreeItem, DialogResponses, IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { getThemedIconPath } from '../../constants';
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * Represents a Cosmos DB DocumentDB (SQL) stored procedure
 */
export class DocDBStoredProcedureTreeItem extends AzureTreeItem<IDocDBTreeRoot> implements IEditableTreeItem {
    public static contextValue: string = "cosmosDBStoredProcedure";
    public readonly contextValue: string = DocDBStoredProcedureTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openStoredProcedure';
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(parent: DocDBStoredProceduresTreeItem, public procedure: ProcedureMeta) {
        super(parent);
        ext.fileSystem.fireChangedEvent(this);
    }

    public get filePath(): string {
        return this.label + '-cosmos-stored-procedure.js';
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

    public async getFileContent(): Promise<string> {
        return this.procedure.body;
    }

    public async refreshImpl(): Promise<void> {
        ext.fileSystem.fireChangedEvent(this);
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const client = this.root.getDocumentClient();
        this.procedure = await new Promise<ProcedureMeta>((resolve, reject) => client.replaceStoredProcedure(
            this.link,
            { body: content, id: this.procedure.id },
            (err, updated: ProcedureMeta) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(updated);
                }
            })
        );
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemedIconPath('Process_16x.svg');
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
