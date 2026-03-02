/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { type CosmosDBItemResourceItem } from '../../tree/cosmosdb/CosmosDBItemResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { extractPartitionKey } from '../../utils/document';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBDeleteItem(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node?.element
        : isTreeElement(node)
          ? node
          : await pickAppResource<CosmosDBItemResourceItem>(context, {
                type: [AzExtResourceType.AzureCosmosDb],
                expectedChildContextValue: ['treeItem.item'],
            });

    if (!element) {
        return undefined;
    }

    if (isTreeElementWithExperience(element)) {
        context.telemetry.properties.experience = element.experience.api;
    }

    if (!isTreeElementWithContextValue(element) || !element.contextValue.includes('treeItem.item')) {
        return undefined;
    }

    const itemNode = element as CosmosDBItemResourceItem;
    const databaseId = itemNode.model.database.id;
    const containerId = itemNode.model.container.id;
    const partitionKeyDefinition = itemNode.model.container.partitionKey;
    const item = itemNode.model.item;

    if (item.id === undefined) {
        vscode.window.showErrorMessage(l10n.t('Item id is required'));
        return undefined;
    }

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete item?'),
        l10n.t('Delete item and its contents?') + '\n' + l10n.t('This cannot be undone.'),
        item.id,
    );

    if (!confirmed) {
        return;
    }

    try {
        let success = false;
        await ext.state.showDeleting(itemNode.id, async () => {
            await withClaimsChallengeHandling(itemNode.model.accountInfo, async (cosmosClient) => {
                const response = await cosmosClient
                    .database(databaseId)
                    .container(containerId)
                    .item(
                        item.id!,
                        partitionKeyDefinition ? extractPartitionKey(item, partitionKeyDefinition) : undefined,
                    )
                    .delete();
                success = response.statusCode === 204;
            });
        });

        if (success) {
            showConfirmationAsInSettings(
                l10n.t('The item {id} has been deleted.', { id: item.id ? `"${item.id}"` : '' }),
            );
        }
    } finally {
        const lastSlashIndex = itemNode.id.lastIndexOf('/');
        let parentId = itemNode.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}
