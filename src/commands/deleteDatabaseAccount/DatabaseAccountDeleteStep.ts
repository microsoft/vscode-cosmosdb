/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type DeleteWizardContext } from './DeleteWizardContext';
import { deleteCosmosDBAccount } from './deleteCosmosDBAccount';

export class DatabaseAccountDeleteStep extends AzureWizardExecuteStep<DeleteWizardContext> {
    public priority: number = 100;

    public async execute(context: DeleteWizardContext): Promise<void> {
        await ext.state.showDeleting(context.node.id, () => deleteCosmosDBAccount(context, context.node));
        ext.cosmosDBBranchDataProvider.refresh();
    }

    public shouldExecute(_wizardContext: DeleteWizardContext): boolean {
        return true;
    }
}
