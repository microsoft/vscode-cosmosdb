/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TriggerOperation, TriggerType } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type EditableFileSystemItem } from '../../DatabasesFileSystem';
import { type DocumentDBTriggerModel } from '../../tree/docdb/models/DocumentDBTriggerModel';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { getCosmosClient } from '../getCosmosClient';

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

export class TriggerFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(
        public readonly id: string,
        public readonly model: DocumentDBTriggerModel,
        public readonly experience: Experience,
    ) {}

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
