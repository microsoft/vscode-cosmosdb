/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { type DeleteWizardContext } from './DeleteWizardContext';
import { deleteCosmosDBAccount } from './deleteCosmosDBAccount';
import { deleteMongoClustersAccount } from './deleteMongoClustersAccount';

export class DatabaseAccountDeleteStep extends AzureWizardExecuteStep<DeleteWizardContext> {
    public priority: number = 100;

    public async execute(context: DeleteWizardContext): Promise<void> {
        if (context.node instanceof AzExtTreeItem) {
            await context.node.deleteTreeItem(context);
        } else if (context.node instanceof CosmosDBAccountResourceItemBase) {
            await ext.state.showDeleting(context.node.id, () =>
                deleteCosmosDBAccount(context, context.node as CosmosDBAccountResourceItemBase),
            );
            ext.cosmosDBBranchDataProvider.refresh();
        } else if (context.node instanceof MongoClusterResourceItem) {
            await ext.state.showDeleting(context.node.id, () =>
                deleteMongoClustersAccount(context, context.node as MongoClusterResourceItem),
            );
            ext.mongoClustersBranchDataProvider.refresh();
        } else {
            throw new Error('Unexpected node type');
        }
    }

    public shouldExecute(_wizardContext: DeleteWizardContext): boolean {
        return true;
    }
}
