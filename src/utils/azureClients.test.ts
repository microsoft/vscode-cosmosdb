/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createHttpHeaders,
    createPipelineRequest,
    type Pipeline,
    type PipelinePolicy,
    type PipelineResponse,
    type SendRequest,
} from '@azure/core-rest-pipeline';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@microsoft/vscode-azext-azureutils', () => ({ createAzureClient: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({ createSubscriptionContext: vi.fn() }));

import { COSMOSDB_ARM_API_VERSION, pinCosmosDBApiVersion, PRESERVE_API_VERSION_HEADER } from './azureClients';

function createPolicy(): PipelinePolicy {
    const addPolicy = vi.fn();
    pinCosmosDBApiVersion({ pipeline: { addPolicy } as unknown as Pipeline });
    return addPolicy.mock.calls[0][0] as PipelinePolicy;
}

async function runPolicy(url: string, preserveApiVersion: boolean = false) {
    const policy = createPolicy();
    const request = createPipelineRequest({
        url,
        headers: createHttpHeaders(preserveApiVersion ? { [PRESERVE_API_VERSION_HEADER]: 'true' } : undefined),
    });
    const next = vi.fn(async (pipelineRequest): Promise<PipelineResponse> => {
        return {
            request: pipelineRequest,
            status: 200,
            headers: createHttpHeaders(),
        };
    }) as SendRequest;

    await policy.sendRequest(request, next);
    return request;
}

describe('Cosmos DB ARM API version policy', () => {
    it('rewrites generated database account requests to the pinned API version', async () => {
        const request = await runPolicy(
            'https://management.azure.com/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account?api-version=2025-05-01-preview',
        );

        expect(request.url).toContain(`api-version=${COSMOSDB_ARM_API_VERSION}`);
    });

    it('rewrites DocumentDB LRO polling URLs', async () => {
        const request = await runPolicy(
            'https://management.azure.com/providers/Microsoft.DocumentDB/locations/westeurope/operationResults/id?api-version=2025-05-01-preview',
        );

        expect(request.url).toContain(`api-version=${COSMOSDB_ARM_API_VERSION}`);
    });

    it('preserves an explicit preview version and strips the internal marker header', async () => {
        const url =
            'https://management.azure.com/subscriptions/sub/providers/Microsoft.DocumentDB/databaseAccounts/account/throughputBuckets?api-version=2025-05-01-preview';
        const request = await runPolicy(url, true);

        expect(request.url).toBe(url);
        expect(request.headers.has(PRESERVE_API_VERSION_HEADER)).toBe(false);
    });

    it('does not rewrite requests for another ARM provider', async () => {
        const url =
            'https://management.azure.com/subscriptions/sub/providers/Microsoft.Insights/metrics?api-version=2023-10-01';
        const request = await runPolicy(url);

        expect(request.url).toBe(url);
    });
});
