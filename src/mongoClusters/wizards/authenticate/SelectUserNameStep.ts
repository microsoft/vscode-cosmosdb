/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unused-vars */
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { QuickPickItemKind, ThemeIcon } from 'vscode';
import { localize } from '../../../utils/localize';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class SelectUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const res = await context.ui.showQuickPick(
            [
                { label: 'Administrator', kind: QuickPickItemKind.Separator },
                {
                    label: context.adminUserName,
                    iconPath: new ThemeIcon('account'), // https://code.visualstudio.com/api/references/icons-in-labels#icon-listing
                },
                { label: 'All Users', kind: QuickPickItemKind.Separator },
                ...context.otherUserNames.map(
                    // '...' is the spread operator
                    (userName) => ({ label: userName, iconPath: new ThemeIcon('person') }),
                ),
            ],
            {
                placeHolder: localize(
                    'mongoClustersAuthWizardUserName',
                    'Please select a user name to authenticate with',
                ),
                suppressPersistence: true,
            },
        );

        context.selectedUserName = res.label;
    }

    public configureBeforePrompt(wizardContext: AuthenticateWizardContext): void {
        // in case there is actually only the admin user name specified,
        // we can skip the prompt and just select the admin user name.
        if (wizardContext.otherUserNames.length === 0) {
            wizardContext.selectedUserName = wizardContext.adminUserName;
        }
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return !context.selectedUserName;
    }
}
