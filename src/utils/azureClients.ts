/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { type PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { createAzureClient } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

// Lazy-load @azure packages to improve startup performance.
// NOTE: The client is the only import that matters, the rest of the types disappear when compiled to JavaScript

export async function createCosmosDBClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    const { CosmosDBManagementClient } = await import('@azure/arm-cosmosdb');
    return createAzureClient([context, subContext], CosmosDBManagementClient);
}

export async function createCosmosDBManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    const { CosmosDBManagementClient } = await import('@azure/arm-cosmosdb');
    return createAzureClient([context, subContext], CosmosDBManagementClient);
}

export async function createPostgreSQLClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<PostgreSQLManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    const { PostgreSQLManagementClient } = await import('@azure/arm-postgresql');
    return createAzureClient([context, subContext], PostgreSQLManagementClient);
}

export async function createPostgreSQLFlexibleClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<PostgreSQLManagementFlexibleServerClient> {
    const subContext = createSubscriptionContext(subscription);
    const { PostgreSQLManagementFlexibleServerClient } = await import('@azure/arm-postgresql-flexible');
    return createAzureClient([context, subContext], PostgreSQLManagementFlexibleServerClient);
}
