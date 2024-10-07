/* eslint-disable @typescript-eslint/no-unused-vars */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../utils/localize';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            //title: 'Authenticate to your Mongo Cluster',
            prompt: `You need to provide the password for '${context.selectedUserName}' in order to continue. Your password will not be stored.`,
            placeHolder: `Password for ${context.selectedUserName}@${context.resourceName}`,
            title: localize(
                'mongoClustersAuthenticateCluster',
                'Authenticate to connect with your MongoDB (vCore) cluster',
            ),
            password: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
