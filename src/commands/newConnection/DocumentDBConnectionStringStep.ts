/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class DocumentDBConnectionStringStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        context.connectionString = (
            await context.ui.showInputBox({
                placeHolder: `AccountEndpoint=...;AccountKey=...`,
                prompt: 'Enter the connection string for your database account',
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        context.valuesToMask.push(context.connectionString);
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.connectionString;
    }

    public validateInput(connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        return undefined;
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        try {
            parseDocDBConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error) {
                return error.message;
            } else {
                return 'Connection string must be of the form "AccountEndpoint=...;AccountKey=..."';
            }
        }

        return undefined;
    }
}
