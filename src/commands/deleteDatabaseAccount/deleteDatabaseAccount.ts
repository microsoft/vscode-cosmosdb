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
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { createActivityContextV2 } from '../../utils/activityUtils';
import { localize } from '../../utils/localize';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deleteDatabaseAccount(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | MongoClusterResourceItem,
    isPostgres: boolean = false,
): Promise<void> {
    let subscription: ISubscriptionContext;
    let accountName: string;
    if (node instanceof AzExtTreeItem) {
        subscription = node.subscription;
        accountName = node.label;
    } else if (node instanceof CosmosDBAccountResourceItemBase && 'subscription' in node.account) {
        subscription = createSubscriptionContext(node.account.subscription as AzureSubscription);
        accountName = node.account.name;
    } else if (node instanceof MongoClusterResourceItem) {
        subscription = createSubscriptionContext(node.subscription);
        accountName = node.mongoCluster.name;
    } else {
        // Not all CosmosAccountResourceItemBase instances have a subscription property (attached account does not),
        // so we need to create a subscription context
        throw new Error('Subscription is required to delete an account.');
    }

    const activityContext = await createActivityContextV2();
    const wizardContext: DeleteWizardContext = Object.assign(context, {
        node,
        deletePostgres: isPostgres,
        subscription: subscription,
        ...activityContext,
    });

    const title = isPostgres
        ? localize('deletePoSer', 'Delete Postgres Server "{0}"', accountName)
        : localize('deleteDbAcc', 'Delete Database Account "{0}"', accountName);

    const confirmationMessage = isPostgres
        ? localize(
              'deleteAccountConfirm',
              'Are you sure you want to delete server "{0}" and its contents?',
              accountName,
          )
        : localize(
              'deleteAccountConfirm',
              'Are you sure you want to delete account "{0}" and its contents?',
              accountName,
          );

    const wizard = new AzureWizard(wizardContext, {
        title,
        promptSteps: [new DeleteConfirmationStep(confirmationMessage)],
        executeSteps: [new DatabaseAccountDeleteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
