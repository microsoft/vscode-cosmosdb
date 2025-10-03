/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import { getTriggerType } from '../../cosmosdb/fs/TriggerFileDescriptor';
import { type CreateTriggerWizardContext } from './CreateTriggerWizardContext';

export class CosmosDBTriggerTypeStep extends AzureWizardPromptStep<CreateTriggerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateTriggerWizardContext): Promise<void> {
        context.triggerType = await getTriggerType(context);
    }

    public shouldPrompt(context: CreateTriggerWizardContext): boolean {
        return !!context.triggerName;
    }
}
