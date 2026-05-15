/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType, type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type CosmosDBContainerResourceItem } from '../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemResourceItem } from '../tree/cosmosdb/CosmosDBItemResourceItem';
import { type CosmosDBItemsResourceItem } from '../tree/cosmosdb/CosmosDBItemsResourceItem';
import { pickAppResource } from '../utils/pickItem/pickAppResource';
import { type CosmosDBCredential } from './CosmosDBCredential';

export type NoSqlQueryConnection = {
    accountId?: string; // Optional, used to identify the node in the tree
    /**
     * Cosmos DB account name. Populated from the source account when the
     * connection is created from a tree node; required by ARM control-plane
     * operations.
     */
    accountName?: string;
    /**
     * Azure subscription context. Populated only for Azure-signed-in accounts;
     * undefined for the local emulator and workspace-attached connection-string
     * accounts. Required (together with {@link resourceGroup} and
     * {@link accountName}) for ARM control-plane operations.
     */
    subscription?: AzureSubscription;
    /**
     * Resource group name for the Cosmos DB account. Populated together with
     * {@link subscription}.
     */
    resourceGroup?: string;
    databaseId: string;
    containerId: string;
    endpoint: string;
    credentials: CosmosDBCredential[];
    isEmulator: boolean;
};

export function isNoSqlQueryConnection(connection: unknown): connection is NoSqlQueryConnection {
    return (
        !!connection &&
        typeof connection === 'object' &&
        'databaseId' in connection &&
        typeof connection.databaseId === 'string' &&
        'containerId' in connection &&
        typeof connection.containerId === 'string' &&
        'endpoint' in connection &&
        typeof connection.endpoint === 'string' &&
        'credentials' in connection &&
        Array.isArray(connection.credentials) &&
        'isEmulator' in connection &&
        typeof connection.isEmulator === 'boolean'
    );
}

export function createNoSqlQueryConnection(
    node: CosmosDBContainerResourceItem | CosmosDBItemsResourceItem | CosmosDBItemResourceItem,
): NoSqlQueryConnection {
    const accountInfo = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;

    return {
        accountId: accountInfo.id,
        accountName: accountInfo.name,
        subscription: accountInfo.subscription,
        resourceGroup: accountInfo.resourceGroup,
        databaseId: databaseId,
        containerId: containerId,
        endpoint: accountInfo.endpoint,
        credentials: accountInfo.credentials,
        isEmulator: accountInfo.isEmulator,
    };
}

export async function getNoSqlQueryConnection(): Promise<NoSqlQueryConnection | undefined> {
    return callWithTelemetryAndErrorHandling<NoSqlQueryConnection>('cosmosDB.connectToDatabase', async (context) => {
        const node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
        return createNoSqlQueryConnection(node);
    });
}
