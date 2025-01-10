/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type IDeleteWizardContext } from './IDeleteWizardContext';
import { deleteCosmosDBAccount } from './deleteCosmosDBAccount';

export class DatabaseAccountDeleteStep extends AzureWizardExecuteStep<IDeleteWizardContext> {
    public priority: number = 100;

    public async execute(context: IDeleteWizardContext): Promise<void> {
        if (context.node instanceof AzExtTreeItem) {
            await context.node.deleteTreeItem(context);
        } else {
            await ext.state.showDeleting(context.node.id, async () => {
                return deleteCosmosDBAccount(context, context.node);
            });
        }
    }

    public shouldExecute(_wizardContext: IDeleteWizardContext): boolean {
        return true;
    }
}
