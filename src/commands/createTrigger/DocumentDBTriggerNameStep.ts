/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateTriggerWizardContext } from './CreateTriggerWizardContext';

export class DocumentDBTriggerNameStep extends AzureWizardPromptStep<CreateTriggerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateTriggerWizardContext): Promise<void> {
        context.triggerName = (
            await context.ui.showInputBox({
                prompt: `Enter a trigger name for ${context.containerId}`,
                validateInput: (name: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.triggerName);
    }

    public shouldPrompt(context: CreateTriggerWizardContext): boolean {
        return !context.triggerName;
    }

    public validateInput(name: string | undefined): string | undefined {
        name = name ? name.trim() : '';

        if (name.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (/[/\\?#&]/.test(name)) {
            return `Container name cannot contain the characters '\\', '/', '#', '?', '&'`;
        }

        if (name.length > 255) {
            return 'Trigger name cannot be longer than 255 characters';
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateTriggerWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return 'Trigger name is required.';
        }

        try {
            const { endpoint, credentials, isEmulator } = context.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

            const result = await cosmosClient
                .database(context.databaseId)
                .container(context.containerId)
                .scripts.triggers.readAll()
                .fetchAll();

            if (result.resources && result.resources.filter((t) => t.id === name).length > 0) {
                return `The trigger "${name}" already exists in the container "${context.databaseId}".`;
            }
        } catch (error) {
            ext.outputChannel.appendLine(`Failed to validate trigger name: ${parseError(error).message}`);
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
