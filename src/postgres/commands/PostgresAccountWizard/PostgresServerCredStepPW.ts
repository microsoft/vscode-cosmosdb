/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { nonNullProp } from '../../../utils/nonNull';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCredStepPW extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        const user = nonNullProp(wizardContext, 'adminUser');
        wizardContext.adminPassword = (await ext.ui.showInputBox({
            placeHolder: "Password",
            prompt: 'Enter administrator password for the server.',
            password: true,
            validateInput: (password: string) => validatePassword(user, password),
        })).trim();
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.adminPassword;
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
