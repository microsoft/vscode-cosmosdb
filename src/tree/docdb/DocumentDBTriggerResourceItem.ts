/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TriggerOperation, TriggerType } from '@azure/cosmos';
import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type EditableTreeItem } from '../../DatabasesFileSystem';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBTriggerModel } from './models/DocumentDBTriggerModel';

export async function getTriggerType(context: IActionContext): Promise<TriggerType> {
    const options = Object.keys(TriggerType).map((type) => ({ label: type }));
    const triggerTypeOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: localize('createDocDBTriggerSelectType', 'Select the trigger type'),
    });
    return triggerTypeOption.label === 'Pre' ? TriggerType.Pre : TriggerType.Post;
}

export async function getTriggerOperation(context: IActionContext): Promise<TriggerOperation> {
    const options = Object.keys(TriggerOperation).map((key) => ({ label: key }));
    const triggerOperationOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: localize('createDocDBTriggerSelectOperation', 'Select the trigger operation'),
    });
    return TriggerOperation[triggerOperationOption.label as keyof typeof TriggerOperation];
}

export abstract class DocumentDBTriggerResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue, EditableTreeItem
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.trigger';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    protected constructor(
        public readonly model: DocumentDBTriggerModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/triggers/${model.trigger.id}`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('zap'),
            label: this.model.trigger.id,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Trigger',
                command: 'cosmosDB.openTrigger',
            },
        };
    }

    public get filePath(): string {
        return this.model.trigger.id + '-cosmos-trigger.js';
    }

    public getFileContent(): Promise<string> {
        return Promise.resolve(typeof this.model.trigger.body === 'string' ? this.model.trigger.body : '');
    }

    public async writeFileContent(context: IActionContext, content: string): Promise<void> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const readResponse = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.trigger(this.model.trigger.id)
            .read();

        let triggerType = readResponse.resource?.triggerType;
        let triggerOperation = readResponse.resource?.triggerOperation;

        if (!triggerType) {
            triggerType = await getTriggerType(context);
        }
        if (!triggerOperation) {
            triggerOperation = await getTriggerOperation(context);
        }

        const replace = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.trigger(this.model.trigger.id)
            .replace({
                id: this.id,
                triggerType: triggerType,
                triggerOperation: triggerOperation,
                body: content,
            });
        this.model.trigger = nonNullProp(replace, 'resource');
    }
}
