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
import { type CosmosAccountResourceItemBase } from '../../tree/CosmosAccountResourceItemBase';
import { createActivityContext } from '../../utils/activityUtils';
import { localize } from '../../utils/localize';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type IDeleteWizardContext } from './IDeleteWizardContext';

export async function deleteDatabaseAccount(
    context: IActionContext,
    node: AzExtTreeItem | CosmosAccountResourceItemBase,
    isPostgres: boolean = false,
): Promise<void> {
    let subscription: ISubscriptionContext;
    if (node instanceof AzExtTreeItem) {
        subscription = node.subscription;
    } else if ('subscription' in node.account) {
        subscription = createSubscriptionContext(node.account.subscription as AzureSubscription);
    } else {
        // Not all CosmosAccountResourceItemBase instances have a subscription property (attached account does not),
        // so we need to create a subscription context
        throw new Error('Subscription is required to delete an account.');
    }

    const wizardContext: IDeleteWizardContext = Object.assign(context, {
        node,
        deletePostgres: isPostgres,
        subscription: subscription,
        ...(await createActivityContext()),
    });

    const title = wizardContext.deletePostgres
        ? localize(
              'deletePoSer',
              'Delete Postgres Server "{0}"',
              node instanceof AzExtTreeItem ? node.label : node.account.name,
          )
        : localize(
              'deleteDbAcc',
              'Delete Database Account "{0}"',
              node instanceof AzExtTreeItem ? node.label : node.account.name,
          );

    const confirmationMessage = wizardContext.deletePostgres
        ? localize(
              'deleteAccountConfirm',
              'Are you sure you want to delete server "{0}" and its contents?',
              node instanceof AzExtTreeItem ? node.label : node.account.name,
          )
        : localize(
              'deleteAccountConfirm',
              'Are you sure you want to delete account "{0}" and its contents?',
              node instanceof AzExtTreeItem ? node.label : node.account.name,
          );

    const wizard = new AzureWizard(wizardContext, {
        title,
        promptSteps: [new DeleteConfirmationStep(confirmationMessage)],
        executeSteps: [new DatabaseAccountDeleteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
