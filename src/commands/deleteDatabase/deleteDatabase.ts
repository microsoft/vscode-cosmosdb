/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function deleteAzureDatabase(
    context: IActionContext,
    node?: DocumentDBDatabaseResourceItem | DatabaseItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBDatabaseResourceItem | DatabaseItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.database'],
        });
    }

    if (!node) {
        return undefined;
    }

    return deleteDatabase(context, node);
}

export async function deleteDatabase(
    context: IActionContext,
    node: DocumentDBDatabaseResourceItem | DatabaseItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const databaseId = node instanceof DatabaseItem ? node.databaseInfo.name : node.model.database.id;
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
        const success = await (node instanceof DatabaseItem
            ? deleteMongoDatabase(node)
            : deleteDocumentDBDatabase(node));

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

async function deleteDocumentDBDatabase(node: DocumentDBDatabaseResourceItem): Promise<boolean> {
    const accountInfo = node.model.accountInfo;
    const client = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        const response = await client.database(node.model.database.id).delete();
        success = response.statusCode === 204;
    });

    return success;
}

async function deleteMongoDatabase(node: DatabaseItem): Promise<boolean> {
    const client = await ClustersClient.getClient(node.mongoCluster.id);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        success = await client.dropDatabase(node.databaseInfo.name);
    });

    return success;
}
