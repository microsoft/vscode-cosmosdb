/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class MongoUsernameStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = vscode.l10n.t(`Enter the username for {0}`, context.experience!.shortName);

        const username = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            value: context.username,
            validateInput: (username?: string) => this.validateInput(context, username),
        });

        const parsedConnectionString = new ConnectionString(context.connectionString!);
        parsedConnectionString.username = username;

        context.connectionString = parsedConnectionString.toString();
        context.username = username;

        context.valuesToMask.push(username);
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
            const parsedConnectionString = new ConnectionString(context.connectionString!);
            parsedConnectionString.username = username;

            const connectionString = parsedConnectionString.toString();

            new ConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error && error.name === 'MongoParseError') {
                return error.message;
            } else {
                return vscode.l10n.t('Invalid Connection String: {0}', `${error}`);
            }
        }

        return undefined;
    }
}
