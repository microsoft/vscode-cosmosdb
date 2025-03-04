/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { localize } from '../../utils/localize';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class MongoConnectionStringStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = localize(
            'mongoClusters.addWorkspaceConnection.connectionString.prompt',
            'Enter the connection string of your MongoDB cluster.',
        );
        context.connectionString = (
            await context.ui.showInputBox({
                prompt: prompt,
                ignoreFocusOut: true,
                placeHolder: localize(
                    'mongoClusters.addWorkspaceConnection.connectionString.placeholder',
                    'Starts with mongodb:// or mongodb+srv://',
                ),
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        const parsedConnectionString = new ConnectionString(context.connectionString);
        context.username = parsedConnectionString.username;
        context.password = parsedConnectionString.password;

        context.valuesToMask.push(context.connectionString);
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        try {
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

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.connectionString;
    }

    public validateInput(this: void, connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!(connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://'))) {
            return localize(
                'mongoClusters.addWorkspaceConnection.connectionString.invalidPrefix',
                '"mongodb://" or "mongodb+srv://" must be the prefix of the connection string.',
            );
        }

        return undefined;
    }
}
