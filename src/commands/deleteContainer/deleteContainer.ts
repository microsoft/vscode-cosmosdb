/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBDeleteContainer(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const containerId = node.model.container.id;
    const message =
        node.experience.api === API.Graph
            ? l10n.t('Delete graph "{containerId}" and its contents?', { containerId })
            : l10n.t('Delete container "{containerId}" and its contents?', { containerId });

    const successMessage =
        node.experience.api === API.Graph
            ? l10n.t('The graph "{containerId}" has been deleted.', { containerId })
            : l10n.t('The container "{containerId}" has been deleted.', { containerId });

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: containerId }),
        message + '\n' + l10n.t('This cannot be undone.'),
        containerId,
    );

    if (!confirmed) {
        return;
    }

    try {
        const success = await deleteContainer(node);

        if (success) {
            showConfirmationAsInSettings(successMessage);
        }
    } finally {
        const lastSlashIndex = node.id.lastIndexOf('/');
        let parentId = node.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}

async function deleteContainer(node: CosmosDBContainerResourceItem): Promise<boolean> {
    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        await withClaimsChallengeHandling(node.model.accountInfo, async (cosmosClient) => {
            const response = await cosmosClient
                .database(node.model.database.id)
                .container(node.model.container.id)
                .delete();
            success = response.statusCode === 204;
        });
    });

    return success;
}
