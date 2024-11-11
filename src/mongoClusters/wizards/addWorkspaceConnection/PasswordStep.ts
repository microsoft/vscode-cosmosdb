/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unused-vars */
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { assert } from 'console';
import ConnectionString from 'mongodb-connection-string-url';
import { localize } from '../../../utils/localize';
import { type AddWorkspaceConnectionContext } from './AddWorkspaceConnectionContext';

export class PasswordStep extends AzureWizardPromptStep<AddWorkspaceConnectionContext> {
    private passwordFromCS: string = '';

    public configureBeforePrompt(wizardContext: AddWorkspaceConnectionContext): void | Promise<void> {
        assert(wizardContext.connectionString, 'connectionString is required for UsernameStep');

        const parsedCS = new ConnectionString(wizardContext.connectionString as string);
        this.passwordFromCS = parsedCS.password || '';
    }

    public async prompt(context: AddWorkspaceConnectionContext): Promise<void> {
        const prompt: string = localize(
            'mongoClusters.addWorkspaceConnection.password.prompt',
            'Enter the password for the MongoDB cluster.',
        );

        context.password = await context.ui.showInputBox({
            prompt: prompt,
            value: this.passwordFromCS,
            ignoreFocusOut: true,
            password: true,
        });
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
