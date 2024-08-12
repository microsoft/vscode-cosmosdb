/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { IDeleteWizardContext } from './IDeleteWizardContext';

export class DatabaseAccountDeleteStep extends AzureWizardExecuteStep<IDeleteWizardContext> {
    public priority: number = 100;

    public async execute(context: IDeleteWizardContext): Promise<void> {
        await context.node.deleteTreeItem(context);
    }

    public shouldExecute(_wizardContext: IDeleteWizardContext): boolean {
        return true;
    }
}
