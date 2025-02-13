/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import vscode from 'vscode';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type DocumentDBItemResourceItem } from '../../tree/docdb/DocumentDBItemResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { extractPartitionKey } from '../../utils/document';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function deleteDocumentDBItem(context: IActionContext, node: DocumentDBItemResourceItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (!node) {
        node = await pickAppResource<DocumentDBItemResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.item'],
        });
    }

    if (!node) {
        return undefined;
    }

    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const partitionKeyDefinition = node.model.container.partitionKey;
    const item = node.model.item;

    if (item.id === undefined) {
        vscode.window.showErrorMessage('Document id is required');
        return undefined;
    }

    const confirmed = await getConfirmationAsInSettings(
        `Delete ${item.id ? `"${item.id}"` : 'document'}?`,
        `Delete document ${item.id ? `"${item.id}"` : ''} and its contents?\nThis can't be undone.`,
        item.id,
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
                .item(item.id!, partitionKeyDefinition ? extractPartitionKey(item, partitionKeyDefinition) : undefined)
                .delete();
            success = response.statusCode === 204;
        });

        if (success) {
            showConfirmationAsInSettings(
                localize(
                    'showConfirmation.droppedItem',
                    'The document {0} has been deleted.',
                    item.id ? `"${item.id}"` : '',
                ),
            );
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
