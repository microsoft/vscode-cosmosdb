/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteAccountTarget, type DeleteWizardContext } from './DeleteWizardContext';

export async function cosmosDBDeleteDatabaseAccount(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
          ? node
          : // pickAppResource works only with Azure Resources tree
            await pickAppResource<CosmosDBAccountResourceItem>(context, {
                type: AzExtResourceType.AzureCosmosDb,
                expectedChildContextValue: 'treeItem.account',
            });

    if (!element) {
        return undefined;
    }

    if (!isTreeElementWithExperience(element)) {
        throw new Error(l10n.t('The selected item does not have experience information.'));
    }

    if (!isTreeElementWithContextValue(element) || !element.contextValue.includes('treeItem.account')) {
        throw new Error(l10n.t('The selected item is not a Cosmos DB account.'));
    }

    const accountNode = element as CosmosDBAccountResourceItem;

    context.valuesToMask.push(accountNode.account.id, accountNode.account.name);

    await deleteDatabaseAccount(context, {
        accountId: accountNode.account.id,
        accountName: accountNode.account.name,
        resourceGroup: getResourceGroupFromId(accountNode.account.id),
        subscription: accountNode.account.subscription,
    });
}

export async function deleteDatabaseAccount(context: IActionContext, account: DeleteAccountTarget): Promise<void> {
    const { accountName } = account;
    context.valuesToMask.push(
        account.accountId,
        accountName,
        account.resourceGroup,
        account.subscription.subscriptionId,
    );

    const wizardContext: DeleteWizardContext = { ...context, account };
    const title = l10n.t('Delete Database Account "{0}"', accountName);
    const confirmationMessage = l10n.t('Are you sure you want to delete account "{0}" and its contents?', accountName);

    const confirmed = await getConfirmationAsInSettings(title, confirmationMessage, accountName);
    if (!confirmed) {
        throw new UserCancelledError();
    }

    const wizard = new AzureWizard(wizardContext, {
        title,
        executeSteps: [new DatabaseAccountDeleteStep()],
    });

    await wizard.execute();
}
