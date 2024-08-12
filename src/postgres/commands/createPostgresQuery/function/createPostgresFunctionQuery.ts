/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, IActionContext } from '@microsoft/vscode-azext-utils';
import { PostgresFunctionsTreeItem } from '../../../tree/PostgresFunctionsTreeItem';
import { runPostgresQueryWizard } from '../runPostgresQueryWizard';
import { IPostgresFunctionQueryWizardContext } from './IPostgresFunctionQueryWizardContext';
import { FunctionQueryCreateStep } from './steps/FunctionQueryCreateStep';
import { FunctionQueryNameStep } from './steps/FunctionQueryNameStep';
import { FunctionQueryReturnTypeStep } from './steps/FunctionQueryReturnTypeStep';

export async function createPostgresFunctionQuery(
    context: IActionContext,
    treeItem?: PostgresFunctionsTreeItem,
): Promise<void> {
    const wizardContext: IPostgresFunctionQueryWizardContext = context;
    const wizard = new AzureWizard(wizardContext, {
        promptSteps: [new FunctionQueryNameStep(), new FunctionQueryReturnTypeStep()],
        executeSteps: [new FunctionQueryCreateStep()],
        title: 'Create PostgreSQL Function Query',
    });

    await runPostgresQueryWizard(wizard, wizardContext, treeItem);
}
