/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { type PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { createAzureClient } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

// `@azure/arm-cosmosdb` is imported eagerly: it's used by virtually every
// Cosmos DB code path (control-plane RBAC, offers, account metadata, …) so
// deferring it just adds latency on first interaction. The PostgreSQL ARM
// SDKs below are still dynamically imported — they only matter for PG
// account types and don't need to be on the activation hot path.

// Pin the api-version on outbound requests from the Cosmos DB management client.
//
// The @azure/arm-cosmosdb package's `api-version` parameter is generated as
// `isConstant: true`, so the serializer always emits the SDK's compiled-in
// `defaultValue` and we cannot override it via `client.apiVersion`. The SDK's
// built-in `CustomApiVersionPolicy` is also only installed when the caller
// explicitly passes an `apiVersion` option (which `createAzureClient` does
// not), so we install our own pipeline policy that rewrites the `api-version`
// query parameter on outbound requests targeting `Microsoft.DocumentDB` —
// including the `Azure-AsyncOperation` / `operationResults` LRO polling URLs,
// which live under `/providers/Microsoft.DocumentDB/locations/{loc}/...` and
// are validated against the DocumentDB api-version list as well.
//
// We pin to the latest GA api-version published in the official REST reference
// for `Microsoft.DocumentDB/databaseAccounts`:
// https://learn.microsoft.com/en-us/rest/api/cosmos-db-resource-provider/database-accounts/create-or-update
const COSMOSDB_ARM_API_VERSION = '2025-10-15';
const DOCUMENT_DB_PROVIDER_PATH = '/providers/microsoft.documentdb/';

function pinCosmosDBApiVersion(client: CosmosDBManagementClient): CosmosDBManagementClient {
    const clientWithPipeline = client as unknown as {
        pipeline: { addPolicy: (policy: unknown) => void };
    };
    clientWithPipeline.pipeline.addPolicy({
        name: 'PinCosmosDBApiVersionPolicy',
        async sendRequest(request: { url: string }, next: (req: { url: string }) => Promise<unknown>) {
            const [path, query] = request.url.split('?');
            if (query && path.toLowerCase().includes(DOCUMENT_DB_PROVIDER_PATH)) {
                const rewritten = query
                    .split('&')
                    .map((part) => (part.startsWith('api-version=') ? `api-version=${COSMOSDB_ARM_API_VERSION}` : part))
                    .join('&');
                request.url = `${path}?${rewritten}`;
            }
            return next(request);
        },
    });
    return client;
}

// `async` is preserved for API symmetry with the dynamically-imported
// PostgreSQL client factories below, even though the body is now
// synchronous since `@azure/arm-cosmosdb` is eagerly imported.
// oxlint-disable-next-line @typescript-eslint/require-await
export async function createCosmosDBManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return pinCosmosDBApiVersion(createAzureClient([context, subContext], CosmosDBManagementClient));
}

/**
 * @deprecated Use {@link createCosmosDBManagementClient} instead. Kept as an
 * alias to avoid churning every existing call site.
 */
export const createCosmosDBClient = createCosmosDBManagementClient;

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
