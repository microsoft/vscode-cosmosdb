/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { buildPostgresConnectionString, parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { localize } from '../../utils/localize';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class PostgresUsernameStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        const prompt: string = `Enter the username for ${context.experience.shortName}`;

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

    public validateInput(context: AttachAccountWizardContext, username: string | undefined): string | undefined {
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
                return localize('invalidPostgresConnectionString', 'Invalid connection string: {0}', `${error}`);
            }
        }

        return undefined;
    }
}
