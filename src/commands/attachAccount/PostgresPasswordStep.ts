/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { buildPostgresConnectionString, parsePostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { localize } from '../../utils/localize';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class PostgresPasswordStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        const prompt: string = `Enter the password for ${context.experience!.shortName}`;

        context.password = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            password: true,
            validateInput: (password?: string) => this.validateInput(context, password),
        });

        const pCS = parsePostgresConnectionString(context.connectionString!);
        context.connectionString = buildPostgresConnectionString(
            pCS.hostName,
            pCS.port,
            context.username,
            context.password,
            pCS.databaseName,
        );

        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public validateInput(context: AttachAccountWizardContext, password: string | undefined): string | undefined {
        password = password ? password.trim() : '';

        if (password.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        try {
            const pCS = parsePostgresConnectionString(context.connectionString!);
            const connectionString = buildPostgresConnectionString(
                pCS.hostName,
                pCS.port,
                pCS.username,
                password,
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
