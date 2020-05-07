/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { nonNullProp } from '../../../utils/nonNull';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerCredPWStep extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        const user = nonNullProp(wizardContext, 'adminUser');
        const pwConditionMsg = localize('passwordConditionMsg', 'Password must contain characters from three of the following categories - uppercase letters, lowercase letters, numbers (0-9), and non-alphanumeric characters (!, $, etc.).');
        wizardContext.adminPassword = (await ext.ui.showInputBox({
            placeHolder: localize('pwPlaceholder', 'Administrator Password'),
            prompt: pwConditionMsg,
            password: true,
            validateInput: (password: string) => validatePassword(user, password, pwConditionMsg),
        }));
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.adminPassword;
    }
}

async function validatePassword(username: string, password: string, pwConditionMsg: string): Promise<string | undefined> {
    password = password ? password : '';

    const min = 8;
    const max = 128;

    const regex = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z\d\s]/];
    let numOccurrence = 0;

    regex.map(substring => {
        if (password.match(substring)) {
            numOccurrence++;
        }
    });

    if (password.length < min || password.length > max) {
        return localize('pwLengthCheck', 'Password must be between {0} and {1} characters.', min, max);
    } else if (numOccurrence < 3) {
        return pwConditionMsg;
    } else if (password.includes(username)) {
        return localize('pwUserSimalarityCheck', 'Password cannot contain the username.');
    } else {
        return undefined;
    }
}
