/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TriggerOperation, TriggerType } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type EditableFileSystemItem } from '../../DatabasesFileSystem';
import { type CosmosDBTriggerModel } from '../../tree/cosmosdb/models/CosmosDBTriggerModel';
import { getControlPlane } from '../controlPlane';

export async function getTriggerType(context: IActionContext): Promise<TriggerType> {
    const options = Object.keys(TriggerType).map((type) => ({ label: type }));
    const triggerTypeOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: l10n.t('Select the trigger type'),
    });
    return triggerTypeOption.label === 'Pre' ? TriggerType.Pre : TriggerType.Post;
}

export async function getTriggerOperation(context: IActionContext): Promise<TriggerOperation> {
    const options = Object.keys(TriggerOperation).map((key) => ({ label: key }));
    const triggerOperationOption = await context.ui.showQuickPick<vscode.QuickPickItem>(options, {
        placeHolder: l10n.t('Select the trigger operation'),
    });
    return TriggerOperation[triggerOperationOption.label as keyof typeof TriggerOperation];
}

export class TriggerFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(
        public readonly id: string,
        public readonly model: CosmosDBTriggerModel,
        public readonly experience: Experience,
    ) {}

    public get filePath(): string {
        return this.model.trigger.id + '-cosmos-trigger.js';
    }

    public getFileContent(): Promise<string> {
        return Promise.resolve(typeof this.model.trigger.body === 'string' ? this.model.trigger.body : '');
    }

    public async writeFileContent(context: IActionContext, content: string): Promise<void> {
        const controlPlane = getControlPlane(this.model.accountInfo);
        const existing = await controlPlane.readTrigger(
            this.model.database.id,
            this.model.container.id,
            this.model.trigger.id,
        );

        let triggerType = existing?.triggerType;
        let triggerOperation = existing?.triggerOperation;

        if (!triggerType) {
            triggerType = await getTriggerType(context);
        }
        if (!triggerOperation) {
            triggerOperation = await getTriggerOperation(context);
        }

        this.model.trigger = await controlPlane.replaceTrigger(this.model.database.id, this.model.container.id, {
            id: this.model.trigger.id,
            triggerType,
            triggerOperation,
            body: content,
        });
    }
}
