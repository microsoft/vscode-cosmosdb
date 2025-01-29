/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export class DocumentDBContainerNameStep extends AzureWizardPromptStep<CreateContainerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateContainerWizardContext): Promise<void> {
        context.containerName = (
            await context.ui.showInputBox({
                prompt: `Enter an container id for ${context.databaseId}`,
                validateInput: (name: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.containerName);
    }

    public shouldPrompt(context: CreateContainerWizardContext): boolean {
        return !context.containerName;
    }

    public validateInput(name: string | undefined): string | undefined {
        name = name ? name.trim() : '';

        if (name.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (/[/\\?#]/.test(name)) {
            return `Container name cannot contain the characters '\\', '/', '#', '?'`;
        }

        if (name.length > 255) {
            return 'Container name cannot be longer than 255 characters';
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateContainerWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return 'Container name is required.';
        }

        try {
            const { endpoint, credentials, isEmulator } = context.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

            const result = await cosmosClient.database(context.databaseId).containers.readAll().fetchAll();

            if (result.resources && result.resources.filter((c) => c.id === name).length > 0) {
                return `The collection "${name}" already exists in the database "${context.databaseId}".`;
            }
        } catch (error) {
            ext.outputChannel.appendLine(`Failed to validate container name: ${parseError(error).message}`);
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
