/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Resource, TriggerDefinition } from '@azure/cosmos';
import { AzExtTreeItem, DialogResponses, IActionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from "vscode";
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBTriggersTreeItem, getTriggerOperation, getTriggerType } from './DocDBTriggersTreeItem';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * Represents a Cosmos DB DocumentDB (SQL) trigger
 */
export class DocDBTriggerTreeItem extends AzExtTreeItem implements IEditableTreeItem {
    public static contextValue: string = "cosmosDBTrigger";
    public readonly contextValue: string = DocDBTriggerTreeItem.contextValue;
    public readonly cTime: number = Date.now();
    public readonly parent: DocDBTriggersTreeItem;
    public mTime: number = Date.now();

    constructor(parent: DocDBTriggersTreeItem, public procedure: (TriggerDefinition & Resource)) {
        super(parent);
        ext.fileSystem.fireChangedEvent(this);
        this.commandId = 'cosmosDB.openTrigger';
    }

    public get root(): IDocDBTreeRoot {
        return this.parent.root;
    }

    public get filePath(): string {
        return this.label + '-cosmos-trigger.js';
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

    public async writeFileContent(context: IActionContext, content: string): Promise<void> {
        const client = this.root.getCosmosClient();

        const readResponse = await this.parent.getContainerClient(client).scripts.trigger(this.id).read();
        let triggerType = readResponse.resource?.triggerType;
        let triggerOperation = readResponse.resource?.triggerOperation;

        if (!triggerType) {
            triggerType = await getTriggerType(context);
        }
        if (!triggerOperation) {
            triggerOperation = await getTriggerOperation(context);
        }

        const replace = await this.parent.getContainerClient(client).scripts.trigger(this.id).replace({
            id: this.id,
            triggerType: triggerType,
            triggerOperation: triggerOperation,
            body: content
        });
        this.procedure = nonNullProp(replace, 'resource');
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('zap');
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete trigger '${this.label}'?`;
        await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteTrigger' }, DialogResponses.deleteResponse);
        const client = this.root.getCosmosClient();
        await this.parent.getContainerClient(client).scripts.trigger(this.id).delete();
    }
}
