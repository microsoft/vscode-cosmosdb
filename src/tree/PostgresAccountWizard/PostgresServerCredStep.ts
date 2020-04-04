/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCredStep extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        wizardContext.adminUser = (await ext.ui.showInputBox({
            placeHolder: "Username",
            prompt: 'Enter administrator username for the server.',
            validateInput: validateUser,
        })).trim();
        const user = nonNullProp(wizardContext, 'adminUser');
        wizardContext.adminPassword = (await ext.ui.showInputBox({
            placeHolder: "Password",
            prompt: 'Enter administrator password for the server.',
            password: true,
            validateInput: (password: string) => validatePassword(user, password),
        })).trim();
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.adminUser && !wizardContext.adminPassword;
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

async function validatePassword(username: string, password: string): Promise<string | undefined> {
    password = password ? password.trim() : '';

    const min = 8;
    const max = 128;

    const regex = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z\d\s]/];
    let numOccurence = 0;

    regex.map(substring => {
        if (password.match(substring)) {
            numOccurence++;
        }
    });

    if (password.length < min || password.length > max) {
        return `Password must be between ${min} and ${max} characters.`;
    } else if (numOccurence < 3) {
        return `Password must contain characters from three of the following categories` +
            `- uppercase letters, lowercase letters, numbers (0-9), and non-alphanumeric characteries (!, $, etc.).`;
    } else if (password.includes(username)) {
        return `Password cannot contain the username.`;
    } else {
        return undefined;
    }
}
