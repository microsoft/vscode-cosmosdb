/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PostgresConnectionStringStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        context.connectionString = (
            await context.ui.showInputBox({
                placeHolder: l10n.t(
                    '"postgres://username:password@host" or "postgres://username:password@host/database"',
                ),
                prompt: l10n.t('Enter the connection string for your database account'),
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        const parsedConnectionString = parsePostgresConnectionString(context.connectionString);
        context.username = parsedConnectionString.username;
        context.password = parsedConnectionString.password;

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

        if (!connectionString.startsWith('postgres://')) {
            return l10n.t('Connection string must start with "postgres://"');
        }

        return undefined;
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        if (connectionString.length === 0) {
            return l10n.t('Connection string is required.');
        }

        try {
            parsePostgresConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error) {
                return error.message;
            } else {
                return l10n.t('Invalid Connection String: {error}', { error: parseError(error).message });
            }
        }

        return undefined;
    }
}
