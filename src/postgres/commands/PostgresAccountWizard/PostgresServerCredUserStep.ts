/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCredUserStep extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        wizardContext.adminUser = (await ext.ui.showInputBox({
            placeHolder: localize('usernamePlaceholder', 'Username'),
            prompt: localize('enterUsernamePrompt', 'Enter administrator username for the server.'),
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
        return localize('usernameLenghtMatch', 'The name must be between {0} and {1} characters.', min, max);
    } else if (!username.match(/^[a-zA-Z0-9_]+$/)) {
        return localize('usernameCharacterCheck', 'The name can only contain letters, numbers, and the "_" character.');
    } else if (username.startsWith('pg_')) {
        return localize('usernameStartWithCheck', 'Admin username cannot start with "pg_".');
    } else if (restricted.includes(username)) {
        const restrictedString = restricted.map(d => `"${d}"`).join(', ');
        return localize('usernameRestrictedCheck', 'Admin username cannot be any of the following: {0}.', restrictedString);
    } else {
        return undefined;
    }
}
