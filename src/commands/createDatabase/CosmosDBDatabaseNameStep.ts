/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export class CosmosDBDatabaseNameStep extends AzureWizardPromptStep<CreateDatabaseWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateDatabaseWizardContext): Promise<void> {
        context.databaseName = (
            await context.ui.showInputBox({
                prompt: l10n.t('Enter a database name'),
                validateInput: (name: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.databaseName);
    }

    public shouldPrompt(context: CreateDatabaseWizardContext): boolean {
        return !context.databaseName;
    }

    public validateInput(name: string | undefined): string | undefined {
        name = name ? name.trim() : '';

        if (name.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (/[/\\?#=]/.test(name)) {
            return l10n.t("Database name cannot contain the characters '\\', '/', '#', '?', '='");
        }

        if (name.length > 255) {
            return l10n.t('Database name cannot be longer than 255 characters');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateDatabaseWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return l10n.t('Database name is required.');
        }

        try {
            const { endpoint, credentials, isEmulator } = context.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

            const result = await cosmosClient.databases.readAll().fetchAll();

            if (result.resources && result.resources.filter((c) => c.id === name).length > 0) {
                return l10n.t('The database "{name}" already exists in the account.', { name });
            }
        } catch (error) {
            ext.outputChannel.appendLine(
                l10n.t('Failed to validate database name: {error}', { error: parseError(error).message }),
            );
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
