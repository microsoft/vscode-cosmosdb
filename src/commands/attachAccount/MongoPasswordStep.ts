/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { localize } from '../../utils/localize';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';

export class MongoPasswordStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        const prompt: string = `Enter the password for ${context.experience!.shortName}`;

        const password = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            password: true,
            value: context.password,
            validateInput: (password?: string) => this.validateInput(context, password),
        });

        const parsedConnectionString = new ConnectionString(context.connectionString!);
        parsedConnectionString.password = password;

        context.connectionString = parsedConnectionString.toString();
        context.password = password;

        context.valuesToMask.push(password);
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
            const parsedConnectionString = new ConnectionString(context.connectionString!);
            parsedConnectionString.password = password;

            const connectionString = parsedConnectionString.toString();

            new ConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error && error.name === 'MongoParseError') {
                return error.message;
            } else {
                return localize(
                    'mongoClusters.addWorkspaceConnection.connectionString.invalid',
                    'Invalid Connection String: {0}',
                    `${error}`,
                );
            }
        }

        return undefined;
    }
}
