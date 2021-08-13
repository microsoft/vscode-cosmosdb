/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { PostgreSQLManagementClient as PostgreSQLFlexibleManagementClient } from '@azure/arm-postgresql-flexible';
import { AzExtClientContext, createAzureClient } from 'vscode-azureextensionui';

// Lazy-load @azure packages to improve startup performance.
// NOTE: The client is the only import that matters, the rest of the types disappear when compiled to JavaScript

export async function createCosmosDBClient(context: AzExtClientContext): Promise<CosmosDBManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createPostgreSQLClient(context: AzExtClientContext): Promise<PostgreSQLManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-postgresql')).PostgreSQLManagementClient);
}

export async function createPostgreSQLFlexibleClient(context: AzExtClientContext): Promise<PostgreSQLFlexibleManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-postgresql-flexible')).PostgreSQLManagementClient);
}
