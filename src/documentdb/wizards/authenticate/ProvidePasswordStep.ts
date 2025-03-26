/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t(
                'You need to provide the password for "{username}" in order to continue. Your password will not be stored.',
                { username: context.selectedUserName ?? '' },
            ),
            placeHolder: l10n.t('Password for {username_at_resource}', {
                username_at_resource: `${context.selectedUserName}@${context.resourceName}`,
            }),
            title: l10n.t('Authenticate to connect with your MongoDB cluster'),
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
