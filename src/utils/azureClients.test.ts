/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { MonitorClient } from '@azure/arm-monitor';
import {
    createHttpHeaders,
    createPipelineRequest,
    type PipelineRequest,
    type PipelineResponse,
    type RawHttpHeaders,
} from '@azure/core-rest-pipeline';
import { createAzureSubscriptionClient, type AzExtSubscriptionClientType } from '@microsoft/vscode-azext-azureutils';
import { type IActionContext, type ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { armTestSubscription, createArmTestContext } from '../cosmosdb/armTestUtils';
import { readCostArmJson } from '../panels/accountOverview/services/advisories/fetchers/costManagement';
import {
    COSMOSDB_ARM_API_VERSION,
    createCosmosDBManagementClient,
    createMonitorClient,
    PRESERVE_API_VERSION_HEADER,
} from './azureClients';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    createSubscriptionContext: (subscription: typeof armTestSubscription) => ({
        subscriptionId: subscription.subscriptionId,
        environment: subscription.environment,
        credentials: {
            getToken: () => Promise.resolve({ token: 'test-token', expiresOnTimestamp: Date.now() + 3_600_000 }),
        },
    }),
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAzureClient: vi.fn(),
    createAzureSubscriptionClient: vi.fn(
        ([, subscription]: [IActionContext, ISubscriptionContext], Client: AzExtSubscriptionClientType<unknown>) =>
            new Client(subscription.credentials, {
                endpoint: subscription.environment.resourceManagerEndpointUrl,
            }),
    ),
}));

describe('modular ARM client factories', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Cost Management retry headers', () => {
        const costPath = '/subscriptions/sub-1/providers/Microsoft.CostManagement/query?api-version=2023-11-01';
        const qpu = 'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after';
        const entity = 'x-ms-ratelimit-microsoft.costmanagement-entity-retry-after';

        beforeEach(() => {
            vi.clearAllMocks();
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        async function probe(headers: RawHttpHeaders, path = costPath) {
            const client = await createCosmosDBManagementClient(createArmTestContext(), armTestSubscription);
            const request = createPipelineRequest({
                url: `https://management.azure.com${path}`,
                method: 'POST',
                body: '{}',
            });
            const sentAt: number[] = [];
            const status = vi.fn<() => number>().mockReturnValue(200).mockReturnValueOnce(429);
            const sendRequest = vi.fn(async (forwarded: PipelineRequest): Promise<PipelineResponse> => {
                sentAt.push(Date.now());
                return { request: forwarded, status: status(), headers: createHttpHeaders(headers), bodyAsText: '{}' };
            });
            return {
                client,
                request,
                status,
                sendRequest,
                sentAt,
                start: () => client.pipeline.sendRequest({ sendRequest }, request),
            };
        }

        async function measureRetryDelay(headers: RawHttpHeaders, delay: number) {
            const run = await probe(headers);
            const response = run.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(run.sendRequest).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(run.sendRequest).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect((await response).status).toBe(200);
            expect(run.sendRequest).toHaveBeenCalledTimes(2);
            expect(run.request.url).toBe(`https://management.azure.com${costPath}`);
            expect(run.request.method).toBe('POST');
            expect(run.request.body).toBe('{}');
            expect(run.request.headers.has('retry-after-ms')).toBe(false);
            return run.sentAt[1] - run.sentAt[0];
        }

        it.each(['qpu', 'entity', 'tenant', 'clienttype'])(
            'honors the %s delay in seconds through SDK retries',
            async (scope) => {
                expect(
                    await measureRetryDelay(
                        { [`x-ms-ratelimit-microsoft.costmanagement-${scope}-retry-after`]: '2' },
                        2000,
                    ),
                ).toBe(2000);
            },
        );

        it('matches header names case-insensitively', async () => {
            expect(
                await measureRetryDelay({ 'X-Ms-Ratelimit-Microsoft.CostManagement-Qpu-Retry-After': '2' }, 2000),
            ).toBe(2000);
        });

        it('uses the longest valid Cost Management delay without an invalid header masking it', async () => {
            expect(
                await measureRetryDelay(
                    {
                        [qpu]: '1',
                        [entity]: '3',
                        'x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after': 'invalid',
                    },
                    3000,
                ),
            ).toBe(3000);
        });

        it.each(['retry-after-ms', 'x-ms-retry-after-ms', 'Retry-After'])(
            'preserves standard %s retries without a Cost Management header',
            async (header) => {
                const delay = header === 'Retry-After' ? 2000 : 2;
                expect(await measureRetryDelay({ [header]: '2' }, delay)).toBe(delay);
            },
        );

        it.each(['retry-after-ms', 'x-ms-retry-after-ms', 'Retry-After'])(
            'does not shorten a longer standard %s delay',
            async (header) => {
                expect(
                    await measureRetryDelay({ [qpu]: '1', [header]: header === 'Retry-After' ? '3' : '3000' }, 3000),
                ).toBe(3000);
            },
        );

        it('honors a longer standard HTTP-date delay', async () => {
            expect(
                await measureRetryDelay({ [qpu]: '1', 'Retry-After': new Date(Date.now() + 3000).toUTCString() }, 3000),
            ).toBe(3000);
        });

        it('does not interpret a numeric Retry-After as a calendar year', async () => {
            vi.setSystemTime(new Date('2026-12-31T23:59:59Z'));
            expect(await measureRetryDelay({ [qpu]: '1', 'Retry-After': '2027' }, 2_027_000)).toBe(2_027_000);
        });

        it('does not let a shorter standard header bypass a longer Cost Management quota', async () => {
            expect(
                await measureRetryDelay(
                    { [qpu]: '3', 'retry-after-ms': '1', 'x-ms-retry-after-ms': '2', 'Retry-After': '1' },
                    3000,
                ),
            ).toBe(3000);
        });

        it('uses a valid Cost Management delay despite an invalid standard header', async () => {
            expect(await measureRetryDelay({ [qpu]: '2', 'retry-after-ms': 'invalid' }, 2000)).toBe(2000);
        });

        it('rounds fractional milliseconds up rather than retrying early', async () => {
            expect(await measureRetryDelay({ [qpu]: '0.0015' }, 2)).toBe(2);
        });

        it('supports the exact Node.js timer limit without overflow', async () => {
            expect(await measureRetryDelay({ [qpu]: '2147483.647' }, 2_147_483_647)).toBe(2_147_483_647);
        });

        it.each(['', ' ', 'invalid', 'NaN', 'Infinity', '-1', '1e309', '2147483.648'])(
            'does not invent a retry delay for an invalid Cost Management header: %j',
            async (value) => {
                const run = await probe({ [qpu]: value });
                const response = run.start();
                await vi.runAllTimersAsync();
                expect((await response).status).toBe(429);
                expect(run.sendRequest).toHaveBeenCalledOnce();
            },
        );

        it.each([
            '/subscriptions/sub-1/providers/Microsoft.DocumentDB/databaseAccounts/account',
            '/subscriptions/sub-1/providers/Microsoft.Insights/metrics',
            '/subscriptions/sub-1/providers/Microsoft.CostManagementOther/query',
            '/subscriptions/sub-1/locations?other=/providers/Microsoft.CostManagement/query',
        ])('does not apply Cost Management headers to unrelated requests: %s', async (path) => {
            const run = await probe({ [qpu]: '0' }, path);
            const response = run.start();
            await vi.runAllTimersAsync();
            expect((await response).status).toBe(429);
            expect(run.sendRequest).toHaveBeenCalledOnce();
        });

        it.each([200, 400, 403, 404])(
            'does not retry or rewrite HTTP %i with a Cost Management delay',
            async (status) => {
                const run = await probe({ [qpu]: '2' });
                run.status.mockReset().mockReturnValue(status);
                const response = run.start();
                await vi.runAllTimersAsync();
                const result = await response;
                expect(result.status).toBe(status);
                expect(result.headers.has('retry-after-ms')).toBe(false);
                expect(run.sendRequest).toHaveBeenCalledOnce();
            },
        );

        it('keeps the existing default limit of three retries, not a nested retry budget', async () => {
            const run = await probe({ [qpu]: '0' });
            run.status.mockReset().mockReturnValue(429);
            const response = run.start();
            await vi.runAllTimersAsync();
            expect((await response).status).toBe(429);
            expect(run.sendRequest).toHaveBeenCalledTimes(4);
        });

        it('preserves an explicitly disabled SDK retry budget', async () => {
            vi.mocked(createAzureSubscriptionClient).mockImplementationOnce((context, Client) => {
                if (!Array.isArray(context) || !('credentials' in context[1])) {
                    throw new Error('Expected a subscription-scoped client context.');
                }
                const subscription = context[1];
                return new Client(subscription.credentials, {
                    endpoint: subscription.environment.resourceManagerEndpointUrl,
                    retryOptions: { maxRetries: 0 },
                });
            });
            const run = await probe({ [qpu]: '0' });
            const response = run.start();
            await vi.runAllTimersAsync();
            expect((await response).status).toBe(429);
            expect(run.sendRequest).toHaveBeenCalledOnce();
        });

        it('retains SDK cancellation while waiting for the server delay', async () => {
            const run = await probe({ [qpu]: '10' });
            const controller = new AbortController();
            run.request.abortSignal = controller.signal;
            const response = run.start();
            await vi.advanceTimersByTimeAsync(1000);
            expect(run.sendRequest).toHaveBeenCalledOnce();
            controller.abort();
            await expect(response).rejects.toMatchObject({ name: 'AbortError' });
            await vi.advanceTimersByTimeAsync(10_000);
            expect(run.sendRequest).toHaveBeenCalledOnce();
        });

        it('retries through the production Cost Management reader without changing its request or result', async () => {
            const run = await probe({ [qpu]: '1' });
            const send = run.client.pipeline.sendRequest.bind(run.client.pipeline);
            const pipelineSend = vi
                .spyOn(run.client.pipeline, 'sendRequest')
                .mockImplementation((_http, request) => send({ sendRequest: run.sendRequest }, request));
            try {
                const result = readCostArmJson(
                    run.client,
                    {
                        subscriptionId: 'sub-1',
                        resourceManagerEndpoint: 'https://management.azure.com/',
                        locationNames: [],
                    },
                    costPath,
                    { type: 'AmortizedCost' },
                );
                await vi.runAllTimersAsync();
                expect(await result).toEqual({});
                expect(run.sendRequest).toHaveBeenCalledTimes(2);
                expect(run.sentAt[1] - run.sentAt[0]).toBe(1000);
                expect(pipelineSend).toHaveBeenCalledOnce();
                expect(run.sendRequest.mock.calls[0][0].body).toBe('{"type":"AmortizedCost"}');
            } finally {
                pipelineSend.mockRestore();
            }
        });
    });

    it.each([
        ['public', 'https://management.azure.com/'],
        ['sovereign', 'https://management.usgovcloudapi.net/'],
    ])('preserves subscription and %s cloud endpoint through the extension factory', async (_cloud, endpoint) => {
        const subscription = {
            ...armTestSubscription,
            environment: { ...armTestSubscription.environment, resourceManagerEndpointUrl: endpoint },
        };
        const cosmosContext = createArmTestContext();
        const monitorContext = createArmTestContext();
        const cosmos = await createCosmosDBManagementClient(cosmosContext, subscription);
        const monitor = await createMonitorClient(monitorContext, subscription);
        expect(cosmos).toBeInstanceOf(CosmosDBManagementClient);
        expect(monitor).toBeInstanceOf(MonitorClient);
        expect(createAzureSubscriptionClient).toHaveBeenCalledTimes(2);
        expect(cosmosContext.valuesToMask).toContain(subscription.subscriptionId);
        expect(monitorContext.valuesToMask).toContain(subscription.subscriptionId);

        const cosmosRequest = vi.spyOn(cosmos.pipeline, 'sendRequest').mockImplementation((_http, request) =>
            Promise.resolve({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({ name: 'account' }),
            }),
        );
        await cosmos.databaseAccounts.get('rg', 'account');
        expect(cosmosRequest.mock.calls[0][1].url).toContain(
            `${endpoint}subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account?`,
        );

        const monitorRequest = vi.spyOn(monitor.pipeline, 'sendRequest').mockImplementation((_http, request) =>
            Promise.resolve({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({ value: [] }),
            }),
        );
        await monitor.activityLogs.list('eventTimestamp ge 2026-01-01T00:00:00Z').next();
        expect(monitorRequest.mock.calls[0][1].url).toContain(`${endpoint}subscriptions/sub-1/`);
    });

    it('retries Cost Management QPU throttling through the existing SDK retry policy', async () => {
        const client = await createCosmosDBManagementClient(createArmTestContext(), armTestSubscription);
        const sendRequest = vi.fn(async (request: PipelineRequest): Promise<PipelineResponse> => ({
            request,
            status: sendRequest.mock.calls.length === 1 ? 429 : 200,
            headers: createHttpHeaders({ 'x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after': '0' }),
            bodyAsText: '{}',
        }));
        const response = await client.pipeline.sendRequest(
            { sendRequest },
            createPipelineRequest({
                url: 'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.CostManagement/query?api-version=2023-11-01',
                method: 'POST',
                body: '{}',
            }),
        );
        expect(sendRequest).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });

    it.each([
        ['/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account', false, true],
        ['/subscriptions/sub/providers/Microsoft.DocumentDB/locations/westus/operationResults/operation', false, true],
        ['/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account', true, false],
        ['/subscriptions/sub/providers/Microsoft.Insights/metrics', false, false],
    ])('pins API versions for %s (preserve: %s)', async (path, preserve, pinned) => {
        const client = await createCosmosDBManagementClient(createArmTestContext(), armTestSubscription);
        const policy = client.pipeline
            .getOrderedPolicies()
            .find((entry) => entry.name === 'PinCosmosDBApiVersionPolicy');
        expect(policy).toBeDefined();
        const request = createPipelineRequest({
            url: `https://management.azure.com${path}?api-version=2025-05-01-preview&other=value`,
            method: 'GET',
            headers: createHttpHeaders(preserve ? { [PRESERVE_API_VERSION_HEADER]: 'true' } : {}),
        });
        const next = vi.fn((forwarded: PipelineRequest): Promise<PipelineResponse> =>
            Promise.resolve({ request: forwarded, status: 200, headers: createHttpHeaders() }),
        );
        await policy!.sendRequest(request, next);
        const url = new URL(request.url);
        expect(url.searchParams.get('api-version')).toBe(pinned ? COSMOSDB_ARM_API_VERSION : '2025-05-01-preview');
        expect(url.searchParams.get('other')).toBe('value');
        expect(request.headers.has(PRESERVE_API_VERSION_HEADER)).toBe(false);
        expect(next).toHaveBeenCalledWith(request);
    });
});
