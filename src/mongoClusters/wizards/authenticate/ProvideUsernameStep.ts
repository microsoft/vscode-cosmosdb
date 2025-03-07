/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unused-vars */
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as vscode from 'vscode';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: vscode.l10n.t(`Please provide the username for '{0}':`, context.resourceName),
            placeHolder: vscode.l10n.t(`Username for {0}`, context.resourceName),
            value: context.adminUserName,
            title: vscode.l10n.t('Authenticate to connect with your MongoDB cluster'),
            ignoreFocusOut: true,
        });

        context.selectedUserName = username.trim();

        context.valuesToMask.push(context.selectedUserName, username);
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return context.selectedUserName === undefined;
    }
}
