/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { type CosmosDBDatabaseResourceItem } from '../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBDeleteDatabase(
    context: IActionContext,
    node?: CosmosDBDatabaseResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBDatabaseResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.database'],
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const databaseId = node.model.database.id;
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: databaseId }),
        l10n.t('Delete database "{databaseId}" and its contents?', { databaseId }) +
            '\n' +
            l10n.t('This cannot be undone.'),
        databaseId,
    );

    if (!confirmed) {
        return;
    }

    try {
        const success = await deleteDatabase(node);

        if (success) {
            showConfirmationAsInSettings(l10n.t('The "{databaseId}" database has been deleted.', { databaseId }));
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

async function deleteDatabase(node: CosmosDBDatabaseResourceItem): Promise<boolean> {
    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        await withClaimsChallengeHandling(node.model.accountInfo, async (cosmosClient) => {
            const response = await cosmosClient.database(node.model.database.id).delete();
            success = response.statusCode === 204;
        });
    });

    return success;
}
