/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtTreeItem,
    AzureWizard,
    createSubscriptionContext,
    DeleteConfirmationStep,
    type IActionContext,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType, type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { createActivityContextV2 } from '../../utils/activityUtils';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deleteAzureDatabaseAccount(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | ClusterItemBase,
) {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | MongoVCoreResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
        });
    }

    if (!node) {
        return undefined;
    }

    await deleteDatabaseAccount(context, node);
}

export async function deleteDatabaseAccount(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | ClusterItemBase,
): Promise<void> {
    let subscription: ISubscriptionContext;
    let accountName: string;
    let isPostgres = false;

    if (node instanceof AzExtTreeItem) {
        subscription = node.subscription;
        accountName = node.label;
        isPostgres = node instanceof PostgresServerTreeItem;
    } else if (node instanceof CosmosDBAccountResourceItemBase && 'subscription' in node.account) {
        subscription = createSubscriptionContext(node.account.subscription as AzureSubscription);
        accountName = node.account.name;
    } else if (node instanceof MongoVCoreResourceItem) {
        subscription = createSubscriptionContext(node.subscription);
        accountName = node.cluster.name;
    } else {
        // Not all CosmosAccountResourceItemBase instances have a subscription property (attached account does not),
        // so we need to create a subscription context
        throw new Error(l10n.t('Subscription is required to delete an account.'));
    }

    const activityContext = await createActivityContextV2();
    const wizardContext: DeleteWizardContext = Object.assign(context, {
        node,
        subscription: subscription,
        ...activityContext,
    });

    const title = isPostgres
        ? l10n.t('Delete Postgres Server "{0}"', accountName)
        : l10n.t('Delete Database Account "{0}"', accountName);

    const confirmationMessage = isPostgres
        ? l10n.t('Are you sure you want to delete server "{0}" and its contents?', accountName)
        : l10n.t('Are you sure you want to delete account "{0}" and its contents?', accountName);

    const wizard = new AzureWizard(wizardContext, {
        title,
        promptSteps: [new DeleteConfirmationStep(confirmationMessage)],
        executeSteps: [new DatabaseAccountDeleteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
