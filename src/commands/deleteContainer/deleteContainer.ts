/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBDeleteGraph(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: ['treeItem.container'],
            unexpectedContextValue: [/experience[.](table|cassandra|core)/i],
        });
    }

    if (!node) {
        return undefined;
    }

    return deleteContainer(context, node);
}

export async function deleteAzureContainer(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem | CollectionItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem | CollectionItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.container', 'treeItem.collection'],
        });
    }

    if (!node) {
        return undefined;
    }

    await deleteContainer(context, node);
}

export async function deleteContainer(
    context: IActionContext,
    node: CosmosDBContainerResourceItem | CollectionItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const containerId = node instanceof CollectionItem ? node.collectionInfo.name : node.model.container.id;
    const message =
        node instanceof CollectionItem
            ? l10n.t('Delete collection "{containerId}" and its contents?', { containerId })
            : node.experience.api === API.Graph
              ? l10n.t('Delete graph "{containerId}" and its contents?', { containerId })
              : l10n.t('Delete container "{containerId}" and its contents?', { containerId });

    const successMessage =
        node instanceof CollectionItem
            ? l10n.t('The collection "{containerId}" has been deleted.', { containerId })
            : node.experience.api === API.Graph
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
        const success =
            node instanceof CollectionItem ? await deleteMongoCollection(node) : await deleteCosmosDBContainer(node);

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

async function deleteMongoCollection(node: CollectionItem): Promise<boolean> {
    const client = await ClustersClient.getClient(node.cluster.id);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        success = await client.dropCollection(node.databaseInfo.name, node.collectionInfo.name);
    });

    return success;
}

async function deleteCosmosDBContainer(node: CosmosDBContainerResourceItem): Promise<boolean> {
    const accountInfo = node.model.accountInfo;
    const client = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        const response = await client.database(node.model.database.id).container(node.model.container.id).delete();
        success = response.statusCode === 204;
    });

    return success;
}
