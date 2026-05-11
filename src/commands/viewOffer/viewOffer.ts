/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import {
    armReadContainerThroughput,
    armReadDatabaseThroughput,
    getArmAccountContext,
} from '../../cosmosdb/armControlPlane';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
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
    const armCtx = getArmAccountContext(accountInfo);

    if (armCtx) {
        const offer = await armReadDatabaseThroughput(armCtx, databaseId);
        // Coalesce to null so JSON.stringify always returns a string; an offer
        // can legitimately be absent (e.g., serverless accounts).
        await vscodeUtil.showNewFile(
            JSON.stringify(offer?.resource ?? null, undefined, 2),
            `offer of ${databaseId}`,
            '.json',
        );
        return;
    }

    const offer = await withClaimsChallengeHandling(accountInfo, async (cosmosClient) =>
        cosmosClient.database(databaseId).readOffer(),
    );
    await vscodeUtil.showNewFile(JSON.stringify(offer.resource, undefined, 2), `offer of ${databaseId}`, '.json');
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
    const armCtx = getArmAccountContext(accountInfo);

    if (armCtx) {
        const offer = await armReadContainerThroughput(armCtx, databaseId, containerId);
        // armReadContainerThroughput already falls back to the database offer
        // when the container has no dedicated throughput, so use containerId
        // as the file label only when we got a container-scoped result.
        const label =
            offer?.name && offer.name.includes('/containers/') ? `offer of ${containerId}` : `offer of ${databaseId}`;
        // Coalesce to null so JSON.stringify always returns a string; an offer
        // can legitimately be absent (e.g., serverless accounts).
        await vscodeUtil.showNewFile(JSON.stringify(offer?.resource ?? null, undefined, 2), label, '.json');
        return;
    }

    await withClaimsChallengeHandling(accountInfo, async (cosmosClient) => {
        const offer = await cosmosClient.database(databaseId).container(containerId).readOffer();

        if (!offer.resource) {
            const dbOffer = await cosmosClient.database(databaseId).readOffer();
            await vscodeUtil.showNewFile(
                JSON.stringify(dbOffer.resource, undefined, 2),
                `offer of ${databaseId}`,
                '.json',
            );
        } else {
            await vscodeUtil.showNewFile(
                JSON.stringify(offer.resource, undefined, 2),
                `offer of ${containerId}`,
                '.json',
            );
        }
    });
}
