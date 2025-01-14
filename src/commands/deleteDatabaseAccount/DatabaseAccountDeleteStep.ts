/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { type MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { CosmosAccountResourceItemBase } from '../../tree/CosmosAccountResourceItemBase';
import { type IDeleteWizardContext } from './IDeleteWizardContext';
import { deleteCosmosDBAccount } from './deleteCosmosDBAccount';
import { deleteMongoClustersAccount } from './deleteMongoClustersAccount';

export class DatabaseAccountDeleteStep extends AzureWizardExecuteStep<IDeleteWizardContext> {
    public priority: number = 100;

    public async execute(context: IDeleteWizardContext): Promise<void> {
        if (context.node instanceof AzExtTreeItem) {
            await context.node.deleteTreeItem(context);
        } else if (context.node instanceof CosmosAccountResourceItemBase) {
            await ext.state.showDeleting(context.node.id, async () => {
                return deleteCosmosDBAccount(context, context.node as CosmosAccountResourceItemBase);
            });
        } else if (context.node instanceof MongoClusterItemBase) {
            await ext.state.showDeleting(context.node.id, async () => {
                return deleteMongoClustersAccount(context, context.node as MongoClusterResourceItem);
            });
            ext.mongoClustersBranchDataProvider.refresh();
        } else {
            throw new Error('Unexpected node type');
        }
    }

    public shouldExecute(_wizardContext: IDeleteWizardContext): boolean {
        return true;
    }
}
