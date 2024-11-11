/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { localize } from '../../../utils/localize';
import { type AddWorkspaceConnectionContext } from './AddWorkspaceConnectionContext';

export class ConnectionStringStep extends AzureWizardPromptStep<AddWorkspaceConnectionContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: AddWorkspaceConnectionContext): Promise<void> {
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
                validateInput: ConnectionStringStep.validateInput,
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        context.valuesToMask.push(context.connectionString);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
        try {
            const parsedCS = new ConnectionString(connectionString);
            console.log(parsedCS);
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

    public shouldPrompt(): boolean {
        return true;
    }

    public static validateInput(this: void, connectionString: string | undefined): string | undefined {
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
