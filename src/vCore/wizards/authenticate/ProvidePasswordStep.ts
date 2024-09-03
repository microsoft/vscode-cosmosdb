/* eslint-disable @typescript-eslint/no-unused-vars */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../utils/localize';
import { type IAuthenticateWizardContext } from './IAuthenticateWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<IAuthenticateWizardContext> {
    public async prompt(context: IAuthenticateWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            //title: 'Authenticate to your vCore Cluster',
            prompt: `You need to provide the password for '${context.selectedUserName}' in order to continue. Your password will not be stored.`,
            placeHolder: `Password for ${context.selectedUserName}@${context.resourceName}`,
            title: localize('authenticatevCoreCluster', 'Authenticate to your vCore Cluster'),
            password: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
