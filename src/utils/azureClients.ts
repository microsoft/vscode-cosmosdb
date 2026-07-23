/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AdvisorManagementClient } from '@azure/arm-advisor';
import { type AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type FeatureClient } from '@azure/arm-features';
import { type MonitorClient } from '@azure/arm-monitor';
import { type PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { type PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { type TokenCredential } from '@azure/core-auth';
import { type KnownMonitorLogsQueryAudience, type LogsQueryClient } from '@azure/monitor-query-logs';
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
export const COSMOSDB_ARM_API_VERSION = '2025-10-15';
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

export async function createFeatureClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<FeatureClient> {
    context.valuesToMask.push(subscription.subscriptionId);
    const subContext = createSubscriptionContext(subscription);
    const { FeatureClient } = await import('@azure/arm-features');
    return createAzureClient([context, subContext], FeatureClient);
}

// `@azure/arm-monitor` is dynamically imported so it only enters the lazy chunk loaded when the Account
// Overview dashboard opens — it must never land on the extension activation hot path.
export async function createMonitorClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<MonitorClient> {
    const subContext = createSubscriptionContext(subscription);
    const { MonitorClient } = await import('@azure/arm-monitor');
    return createAzureClient([context, subContext], MonitorClient);
}

// `@azure/monitor-query-logs` is the data-plane Log Analytics client for the Account Overview dashboard's Tier-2
// derived advisories (DX-002/003/007/010 over the `CDB*` diagnostic-log tables). It is dynamically imported so it
// only enters the lazy chunk loaded when the dashboard opens, never the activation hot path. Unlike the classic
// ARM SDKs it is a modular client — `new LogsQueryClient(credential, options)` with no subscriptionId and a
// data-plane audience (`https://api.loganalytics.io` and sovereign-cloud equivalents) — so it is constructed
// directly with the subscription's credential rather than via `createAzureClient`.
export async function createLogsQueryClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<LogsQueryClient> {
    context.valuesToMask.push(subscription.subscriptionId);
    const subContext = createSubscriptionContext(subscription);
    const { LogsQueryClient, KnownMonitorLogsQueryAudience } = await import('@azure/monitor-query-logs');
    const audience = logAnalyticsAudience(subscription.environment?.name, KnownMonitorLogsQueryAudience);
    return new LogsQueryClient(subContext.credentials as TokenCredential, audience ? { audience } : undefined);
}

/**
 * Maps an Azure environment name to the Log Analytics data-plane audience. Returns `undefined` for the public
 * cloud (the SDK default) and for unknown environments; the sovereign clouds override the Microsoft Entra audience
 * so the token is issued for the correct Log Analytics endpoint.
 *
 * The audience values are read from the SDK's own `KnownMonitorLogsQueryAudience` enum rather than hardcoded here,
 * so if Azure ever changes a sovereign endpoint the mapping tracks the SDK instead of silently drifting. The enum
 * is passed in (destructured from the same dynamic `@azure/monitor-query-logs` import as `LogsQueryClient`) to keep
 * the package off the extension activation hot path. Note the SDK intentionally has no Azure Germany entry — that
 * sovereign cloud was retired — so there is deliberately no case for it.
 */
function logAnalyticsAudience(
    environmentName: string | undefined,
    audiences: typeof KnownMonitorLogsQueryAudience,
): string | undefined {
    switch (environmentName) {
        case 'AzureChinaCloud':
            return audiences.AzureChina;
        case 'AzureUSGovernment':
            return audiences.AzureGovernment;
        default:
            return undefined;
    }
}

// `@azure/arm-advisor` is dynamically imported so it only enters the lazy chunk loaded when the Account Overview
// dashboard opens (Advisor recommendations). It must never land on the extension activation hot path.
export async function createAdvisorClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<AdvisorManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    const { AdvisorManagementClient } = await import('@azure/arm-advisor');
    return createAzureClient([context, subContext], AdvisorManagementClient);
}

// `@azure/arm-alertsmanagement` is dynamically imported for the same reason (Active Alerts).
// Unlike the classic ARM SDKs, this is a "modular" client whose constructor is `(credential, options)` with no
// subscriptionId, and whose operations take an explicit ARM `scope` — so it can't be built via `createAzureClient`
// and is constructed directly with the subscription's credential instead.
export async function createAlertsManagementClient(subscription: AzureSubscription): Promise<AlertsManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    const { AlertsManagementClient } = await import('@azure/arm-alertsmanagement');
    const endpoint = subscription.environment?.resourceManagerEndpointUrl;
    return new AlertsManagementClient(subContext.credentials as TokenCredential, endpoint ? { endpoint } : undefined);
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
