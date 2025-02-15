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
    type ITreeItemPickerContext,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType, type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import {
    cosmosGremlinFilter,
    cosmosMongoFilter,
    cosmosTableFilter,
    postgresFlexibleFilter,
    postgresSingleFilter,
    sqlFilter,
} from '../../constants';
import { ext } from '../../extensionVariables';
import { type MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { createActivityContextV2 } from '../../utils/activityUtils';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function deletePostgresServer(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresServerTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
        });
    }

    if (!node) {
        return undefined;
    }

    await deleteDatabaseAccount(context, node);
}

export async function deleteAccount(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<AzExtTreeItem>(context, {
            filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        });
    }

    await deleteDatabaseAccount(context, node);
}

export async function deleteAzureDatabaseAccount(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | MongoClusterItemBase,
) {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | MongoClusterResourceItem>(context, {
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
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | MongoClusterItemBase,
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
