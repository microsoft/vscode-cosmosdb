/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { MongoClusterResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoClusterResourceItem';
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
            throw new Error(l10n.t('Unexpected node type'));
        }
    }

    public shouldExecute(_wizardContext: DeleteWizardContext): boolean {
        return true;
    }
}
