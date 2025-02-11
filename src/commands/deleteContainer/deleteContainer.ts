/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { API } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { MongoClustersClient } from '../../mongoClusters/MongoClustersClient';
import { CollectionItem } from '../../mongoClusters/tree/CollectionItem';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function deleteGraph(context: IActionContext, node?: DocumentDBContainerResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
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
    node?: DocumentDBContainerResourceItem | CollectionItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem | CollectionItem>(context, {
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
    node: DocumentDBContainerResourceItem | CollectionItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const containerId = node instanceof CollectionItem ? node.collectionInfo.name : node.model.container.id;
    const containerTypeName =
        node instanceof CollectionItem ? 'collection' : node.experience.api === API.Graph ? 'graph' : 'container';

    const confirmed = await getConfirmationAsInSettings(
        `Delete "${containerId}"?`,
        `Delete ${containerTypeName} "${containerId}" and its contents?\nThis can't be undone.`,
        containerId,
    );

    if (!confirmed) {
        return;
    }

    try {
        const success =
            node instanceof CollectionItem ? await deleteMongoCollection(node) : await deleteDocumentDBContainer(node);

        if (success) {
            showConfirmationAsInSettings(
                localize(
                    'showConfirmation.droppedDatabase',
                    `The "{0}" ${containerTypeName} has been deleted.`,
                    containerId,
                ),
            );
        }
    } finally {
        ext.state.notifyChildrenChanged(node.id.replace(`/${containerId}`, ''));
    }
}

async function deleteMongoCollection(node: CollectionItem): Promise<boolean> {
    const client = await MongoClustersClient.getClient(node.mongoCluster.id);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        success = await client.dropCollection(node.databaseInfo.name, node.collectionInfo.name);
    });

    return success;
}

async function deleteDocumentDBContainer(node: DocumentDBContainerResourceItem): Promise<boolean> {
    const accountInfo = node.model.accountInfo;
    const client = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        const response = await client.database(node.model.database.id).container(node.model.container.id).delete();
        success = response.statusCode === 204;
    });

    return success;
}
