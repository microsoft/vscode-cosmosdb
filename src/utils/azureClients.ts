/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { type PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { createAzureClient, type AzExtClientContext } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

// Lazy-load @azure packages to improve startup performance.
// NOTE: The client is the only import that matters, the rest of the types disappear when compiled to JavaScript

export async function createCosmosDBClient(context: AzExtClientContext): Promise<CosmosDBManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createMongoClustersManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createPostgreSQLClient(context: AzExtClientContext): Promise<PostgreSQLManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-postgresql')).PostgreSQLManagementClient);
}

export async function createPostgreSQLFlexibleClient(
    context: AzExtClientContext,
): Promise<PostgreSQLManagementFlexibleServerClient> {
    return createAzureClient(
        context,
        (await import('@azure/arm-postgresql-flexible')).PostgreSQLManagementFlexibleServerClient,
    );
}
