/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { localize } from '../../utils/localize';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class PostgresConnectionStringStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        context.connectionString = (
            await context.ui.showInputBox({
                placeHolder: localize(
                    'attachedPostgresPlaceholder',
                    '"postgres://username:password@host" or "postgres://username:password@host/database"',
                ),
                prompt: 'Enter the connection string for your database account',
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        const parsedConnectionString = parsePostgresConnectionString(context.connectionString);
        context.username = parsedConnectionString.username;
        context.password = parsedConnectionString.password;

        context.valuesToMask.push(context.connectionString);
    }

    public shouldPrompt(context: AttachAccountWizardContext): boolean {
        return !context.connectionString;
    }

    public validateInput(connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!connectionString.startsWith(`postgres://`)) {
            return localize('invalidPostgresConnectionString', 'Connection string must start with "postgres://"');
        }

        return undefined;
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        try {
            parsePostgresConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error) {
                return error.message;
            } else {
                return localize('invalidPostgresConnectionString', 'Invalid connection string: {0}', `${error}`);
            }
        }

        return undefined;
    }
}
