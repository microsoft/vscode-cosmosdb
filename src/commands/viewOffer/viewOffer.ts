/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBDatabaseResourceItem } from '../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import * as vscodeUtil from '../../utils/vscodeUtils';

export async function cosmosDBViewDatabaseOffer(context: IActionContext, node?: CosmosDBDatabaseResourceItem) {
    if (!node) {
        node = await pickAppResource<CosmosDBDatabaseResourceItem>(context, {
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

    const controlPlane = getControlPlane(accountInfo);
    const offer = await controlPlane.readDatabaseThroughput(databaseId);
    await vscodeUtil.showNewFile(
        JSON.stringify(offer?.raw ?? offer ?? {}, undefined, 2),
        `offer of ${databaseId}`,
        '.json',
    );
}

export async function cosmosDBViewContainerOffer(context: IActionContext, node?: CosmosDBContainerResourceItem) {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
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

    const controlPlane = getControlPlane(accountInfo);
    const offer = await controlPlane.readContainerThroughput(databaseId, containerId);
    // The control plane already falls back to the database offer for shared-throughput
    // containers; the resulting payload is what the user sees.
    await vscodeUtil.showNewFile(
        JSON.stringify(offer?.raw ?? offer ?? {}, undefined, 2),
        `offer of ${containerId}`,
        '.json',
    );
}
