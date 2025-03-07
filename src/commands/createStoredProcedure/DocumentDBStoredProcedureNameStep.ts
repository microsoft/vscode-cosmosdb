/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateStoredProcedureWizardContext } from './CreateStoredProcedureWizardContext';

export class DocumentDBStoredProcedureNameStep extends AzureWizardPromptStep<CreateStoredProcedureWizardContext> {
    public hideStepCount: boolean = false;

    public async prompt(context: CreateStoredProcedureWizardContext): Promise<void> {
        context.storedProcedureName = (
            await context.ui.showInputBox({
                prompt: vscode.l10n.t(`Enter a stored procedure name for {0}`, context.containerId),
                validateInput: (name: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.storedProcedureName);
    }

    public shouldPrompt(context: CreateStoredProcedureWizardContext): boolean {
        return !context.storedProcedureName;
    }

    public validateInput(name: string | undefined): string | undefined {
        name = name ? name.trim() : '';

        if (name.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (/[/\\?#&]/.test(name)) {
            return vscode.l10n.t(`Container name cannot contain the characters '\\', '/', '#', '?', '&'`);
        }

        if (name.length > 255) {
            return vscode.l10n.t('Trigger name cannot be longer than 255 characters');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateStoredProcedureWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return vscode.l10n.t('Stored procedure name is required.');
        }

        try {
            const { endpoint, credentials, isEmulator } = context.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

            const result = await cosmosClient
                .database(context.databaseId)
                .container(context.containerId)
                .scripts.storedProcedures.readAll()
                .fetchAll();

            if (result.resources && result.resources.filter((t) => t.id === name).length > 0) {
                return vscode.l10n.t(
                    `The stored procedure "{0}" already exists in the container "{1}".`,
                    name,
                    context.databaseId,
                );
            }
        } catch (error) {
            ext.outputChannel.appendLine(`Failed to validate stored procedure name: ${parseError(error).message}`);
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
