/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { buildPostgresConnectionString, parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PostgresUsernameStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the username for {experience}', {
            experience: context.experience!.shortName,
        });

        context.username = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            value: context.username,
            validateInput: (username?: string) => this.validateInput(context, username),
        });

        const pCS = parsePostgresConnectionString(context.connectionString!);
        context.connectionString = buildPostgresConnectionString(
            pCS.hostName,
            pCS.port,
            context.username,
            context.password,
            pCS.databaseName,
        );

        context.valuesToMask.push(context.username);
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public validateInput(context: NewConnectionWizardContext, username: string | undefined): string | undefined {
        username = username ? username.trim() : '';

        if (username.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        try {
            const pCS = parsePostgresConnectionString(context.connectionString!);
            const connectionString = buildPostgresConnectionString(
                pCS.hostName,
                pCS.port,
                username,
                pCS.password,
                pCS.databaseName,
            );

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
