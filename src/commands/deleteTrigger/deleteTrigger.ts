/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CosmosDBTriggerResourceItem } from '../../tree/cosmosdb/CosmosDBTriggerResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBDeleteTrigger(context: IActionContext, node: CosmosDBTriggerResourceItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (!node) {
        node = await pickAppResource<CosmosDBTriggerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.item'],
        });
    }

    if (!node) {
        return undefined;
    }

    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const triggerId = node.model.trigger.id;

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: triggerId }),
        l10n.t('Delete trigger "{triggerId}" and its contents?', { triggerId }) +
            '\n' +
            l10n.t('This cannot be undone.'),
        triggerId,
    );

    if (!confirmed) {
        return;
    }

    const accountInfo = node.model.accountInfo;
    const client = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);

    try {
        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.trigger(triggerId)
                .delete();
            success = response.statusCode === 204;
        });

        if (success) {
            showConfirmationAsInSettings(l10n.t('The trigger {triggerId} has been deleted.', { triggerId }));
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
