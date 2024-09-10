/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../../../utils/localize';
import { type IPostgresFunctionQueryWizardContext } from '../IPostgresFunctionQueryWizardContext';

export class FunctionQueryCustomReturnTypeStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(context: IPostgresFunctionQueryWizardContext): Promise<void> {
        context.returnType = await context.ui.showInputBox({
            prompt: localize('provideCustomReturnType', 'Provide custom return type'),
        });
    }

    public shouldPrompt(context: IPostgresFunctionQueryWizardContext): boolean {
        return !context.returnType;
    }
}
