/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../../../utils/localize';
import { validateIdentifier } from '../../validateIdentifier';
import { type IPostgresFunctionQueryWizardContext } from '../IPostgresFunctionQueryWizardContext';

export class FunctionQueryNameStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(context: IPostgresFunctionQueryWizardContext): Promise<void> {
        context.name = (
            await context.ui.showInputBox({
                prompt: localize('provideFunctionName', 'Provide function name'),
                validateInput: validateIdentifier,
            })
        ).trim();
    }

    public shouldPrompt(context: IPostgresFunctionQueryWizardContext): boolean {
        return !context.name;
    }
}
