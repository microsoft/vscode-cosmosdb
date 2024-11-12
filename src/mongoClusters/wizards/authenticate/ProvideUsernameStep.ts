/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-unused-vars */
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../utils/localize';

import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: `Please provide the username for '${context.resourceName}':`,
            placeHolder: `Username for ${context.resourceName}`,
            title: localize('mongoClustersAuthenticateCluster', 'Authenticate to connect with your MongoDB cluster'),
        });

        context.selectedUserName = username.trim();
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        // onyl prompt for the username when no name is set
        // and no adminUserName is preconfigured
        return !context.selectedUserName || context.selectedUserName.length === 0;
    }
}
