/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import * as vscodeUtil from '../../utils/vscodeUtils';

export async function viewDocumentDBDatabaseOffer(context: IActionContext, node?: DocumentDBDatabaseResourceItem) {
    if (!node) {
        node = await pickAppResource<DocumentDBDatabaseResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: 'treeItem.database',
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const { endpoint, credentials, isEmulator } = accountInfo;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

    const offer = await cosmosClient.database(databaseId).readOffer();
    await vscodeUtil.showNewFile(JSON.stringify(offer.resource, undefined, 2), `offer of ${databaseId}`, '.json');
}

export async function viewDocumentDBContainerOffer(context: IActionContext, node?: DocumentDBContainerResourceItem) {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: 'treeItem.container',
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const { endpoint, credentials, isEmulator } = accountInfo;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

    const offer = await cosmosClient.database(databaseId).container(containerId).readOffer();
    if (!offer.resource) {
        const dbOffer = await cosmosClient.database(databaseId).readOffer();
        await vscodeUtil.showNewFile(JSON.stringify(dbOffer.resource, undefined, 2), `offer of ${databaseId}`, '.json');
    } else {
        await vscodeUtil.showNewFile(JSON.stringify(offer.resource, undefined, 2), `offer of ${containerId}`, '.json');
    }
}
