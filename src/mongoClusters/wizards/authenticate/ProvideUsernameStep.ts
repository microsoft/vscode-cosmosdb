/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Please provide the username for "{resource}":', { resource: context.resourceName }),
            placeHolder: l10n.t('Username for {resource}', { resource: context.resourceName }),
            value: context.adminUserName,
            title: l10n.t('Authenticate to connect with your MongoDB cluster'),
            ignoreFocusOut: true,
        });

        context.selectedUserName = username.trim();

        context.valuesToMask.push(context.selectedUserName, username);
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return context.selectedUserName === undefined;
    }
}
