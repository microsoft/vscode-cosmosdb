/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export class DocumentDBContainerNameStep extends AzureWizardPromptStep<CreateContainerWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateContainerWizardContext): Promise<void> {
        const { databaseId, experience } = context;
        const prompt =
            experience.api === API.Core
                ? l10n.t('Enter a container name for {databaseId}', { databaseId })
                : l10n.t('Enter a graph name for {databaseId}', { databaseId });
        context.containerName = (
            await context.ui.showInputBox({
                prompt,
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
            return l10n.t("Container name cannot contain the characters '\\', '/', '#', '?'");
        }

        if (name.length > 255) {
            return l10n.t('Container name cannot be longer than 255 characters');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateContainerWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return l10n.t('Container name is required.');
        }

        try {
            const { endpoint, credentials, isEmulator } = context.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

            const result = await cosmosClient.database(context.databaseId).containers.readAll().fetchAll();

            if (result.resources && result.resources.filter((c) => c.id === name).length > 0) {
                return l10n.t('The container "{name}" already exists in the database "{databaseId}".', {
                    name,
                    databaseId: context.databaseId,
                });
            }
        } catch (error) {
            ext.outputChannel.appendLine(
                l10n.t('Failed to validate container name: {error}', { error: parseError(error).message }),
            );
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
