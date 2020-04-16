/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCredStepUser extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        wizardContext.adminUser = (await ext.ui.showInputBox({
            placeHolder: "Username",
            prompt: 'Enter administrator username for the server.',
            validateInput: validateUser,
        })).trim();
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.adminUser;
    }
}

async function validateUser(username: string): Promise<string | undefined> {
    username = username ? username.trim() : '';

    const min = 1;
    const max = 63;

    const restricted = ['azure_superuser', 'azure_pg_admin', 'admin', 'administrator', 'root', 'guest', 'public'];

    if (username.length < min || username.length > max) {
        return `The name must be between ${min} and ${max} characters.`;
    } else if (!username.match(/^[a-zA-Z0-9_]+$/)) {
        return "The name can only contain letters, numbers, and the '_' character.";
    } else if (restricted.includes(username) || username.startsWith('pg_')) {
        return 'Admin username cannot be ' + restricted.join(", ") + " or start with 'pg_\'.";
    } else {
        return undefined;
    }
}
