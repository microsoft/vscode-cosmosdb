/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource, StoredProcedureDefinition } from '@azure/cosmos';
import * as vscode from "vscode";
import { AzureTreeItem, DialogResponses, IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { getThemedIconPath } from '../../constants';
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
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
    public readonly parent: DocDBStoredProceduresTreeItem;
    public mTime: number = Date.now();

    constructor(parent: DocDBStoredProceduresTreeItem, public procedure: (StoredProcedureDefinition & Resource)) {
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
        return typeof this.procedure.body === 'string' ? this.procedure.body : '';

    }

    public async refreshImpl(): Promise<void> {
        ext.fileSystem.fireChangedEvent(this);
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const client = this.root.getCosmosClient();
        const replace = await this.parent.getContainerClient(client).scripts.storedProcedure(this.id).replace({ id: this.id, body: content });
        this.procedure = nonNullProp(replace, 'resource');
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemedIconPath('Process_16x.svg');
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete stored procedure '${this.label}'?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this.root.getCosmosClient();
            await this.parent.getContainerClient(client).scripts.storedProcedure(this.id).delete();
        } else {
            throw new UserCancelledError();
        }
    }
}
