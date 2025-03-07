/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unused-vars */
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: vscode.l10n.t(
                `You need to provide the password for '{0}' in order to continue. Your password will not be stored.`,
                context.selectedUserName!,
            ),
            placeHolder: vscode.l10n.t(`Password for {0}`, `${context.selectedUserName}@${context.resourceName}`),
            title: vscode.l10n.t('Authenticate to connect with your MongoDB cluster'),
            password: true,
            ignoreFocusOut: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
