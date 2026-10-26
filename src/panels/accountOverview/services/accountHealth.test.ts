/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveAccountHealth, getAccountHealth } from './accountHealth';
import { DEFAULT_HEALTH_THRESHOLDS, getInventoryMetrics } from './inventoryMetrics';
import { dims, iso, mockClient, type Series, throwingClient } from './testFixtures';

const now = Date.UTC(2026, 9, 20, 12);
const minute = 60_000;

function requests(status: string, count: number, buckets = 5): Series {
    return {
        metadatavalues: [{ name: { value: 'StatusCode' }, value: status }],
        data: Array.from({ length: buckets }, (_, i) => ({
            timeStamp: iso(now - (5 - i) * minute),
            count,
        })),
    };
}

afterEach(() => vi.restoreAllMocks());

describe('account health', () => {
    it.each([
        { state: 'Succeeded', observed: false, throttled: false, expected: undefined },
        { state: undefined, observed: false, throttled: false, expected: undefined },
        { state: 'Succeeded', observed: true, throttled: false, expected: 'Healthy' },
        { state: 'Updating', observed: false, throttled: false, expected: 'Needs Attention' },
        { state: 'Failed', observed: false, throttled: false, expected: 'Critical' },
        { state: 'Canceled', observed: true, throttled: false, expected: 'Critical' },
        { state: 'Updating', observed: true, throttled: true, expected: 'Critical' },
    ] as const)('derives $expected from $state and observed=$observed, throttled=$throttled', (input) => {
        expect(deriveAccountHealth(input.state, input.throttled, input.observed)).toBe(input.expected);
    });

    it('uses one fixed-window, account-wide request independent of container count and normalized RU', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const client = mockClient({ TotalRequests: { value: [{ timeseries: [requests('200', 100)] }] } });
        const list = vi.spyOn(client.metrics, 'list');
        expect(await getAccountHealth(client, '/account', 'Succeeded')).toEqual({
            available: true,
            health: 'Healthy',
            hasSustainedThrottling: false,
            reason: undefined,
            generatedAt: now,
        });
        expect(list).toHaveBeenCalledExactlyOnceWith('/account', {
            metricnames: 'TotalRequests',
            aggregation: 'Count',
            timespan: `${iso(now - 60 * minute)}/${iso(now)}`,
            interval: 'PT1M',
            filter: "StatusCode eq '*'",
        });
    });

    it('does not promote one throttled container to account Critical when its account-wide share is low', async () => {
        const split = [
            { ...requests('429', 100), metadatavalues: dims('db', 'hot', '429') },
            { ...requests('200', 99_900), metadatavalues: dims('other-db', 'busy', '200') },
        ];
        const client = mockClient({});
        const splitClient = mockClient({ TotalRequests: { value: [{ timeseries: split }] } });
        const aggregateClient = mockClient({
            TotalRequests: { value: [{ timeseries: [requests('429', 100), requests('200', 99_900)] }] },
        });
        const list = vi
            .spyOn(client.metrics, 'list')
            .mockImplementation((resource, options) =>
                (options?.filter === "StatusCode eq '*'" ? aggregateClient : splitClient).metrics.list(
                    resource,
                    options,
                ),
            );
        const inventory = await getInventoryMetrics(client, '/account', '24H', DEFAULT_HEALTH_THRESHOLDS);
        expect(inventory.metrics['db/hot'].health).toBe('Critical');
        expect(inventory).not.toHaveProperty('accountHealth');
        list.mockClear();
        expect(await getAccountHealth(client, '/account', 'Succeeded')).toMatchObject({
            available: true,
            health: 'Healthy',
        });
        expect(list).toHaveBeenCalledTimes(1);
        expect(list.mock.calls[0][1]?.filter).toBe("StatusCode eq '*'");
    });

    it.each([
        { throttled: 1, successful: 99, buckets: 5, health: 'Healthy' },
        { throttled: 2, successful: 98, buckets: 4, health: 'Healthy' },
        { throttled: 2, successful: 98, buckets: 5, health: 'Critical' },
        { throttled: 0, successful: 0, buckets: 5, health: 'Healthy' },
    ])('keeps the existing share/duration policy: $throttled%, $buckets buckets', async (input) => {
        const client = mockClient({
            TotalRequests: {
                value: [
                    {
                        timeseries: [
                            requests('429', input.throttled, input.buckets),
                            requests('200', input.successful, input.buckets),
                        ],
                    },
                ],
            },
        });
        expect(await getAccountHealth(client, '/account', 'Succeeded')).toMatchObject({
            available: true,
            health: input.health,
            hasSustainedThrottling: input.health === 'Critical',
        });
    });

    it.each([
        { client: undefined, reason: 'noData' },
        { client: mockClient({}), reason: 'noData' },
        {
            client: mockClient({ TotalRequests: { value: [{ timeseries: [requests('200', 0, 0)] }] } }),
            reason: 'noData',
        },
        {
            client: mockClient({ TotalRequests: { value: [{ timeseries: [{ data: [{ timeStamp: iso(now) }] }] }] } }),
            reason: 'noData',
        },
        { client: throwingClient({ statusCode: 403 }), reason: 'rbac' },
        { client: throwingClient({ statusCode: 500 }), reason: 'error' },
    ])('preserves unavailable reason $reason without inventing Healthy', async ({ client, reason }) => {
        expect(await getAccountHealth(client, '/account', 'Succeeded')).toMatchObject({
            available: false,
            health: undefined,
            reason,
        });
        expect(await getAccountHealth(client, '/account', 'Failed')).toMatchObject({
            available: false,
            health: 'Critical',
            reason,
        });
    });

    it('surfaces per-metric Monitor errors rather than treating them as healthy or no data', async () => {
        const client = mockClient({});
        vi.spyOn(client.metrics, 'list').mockResolvedValue({
            timespan: `${iso(now - 60 * minute)}/${iso(now)}`,
            value: [
                {
                    id: 'TotalRequests',
                    type: 'Microsoft.Insights/metrics',
                    name: { value: 'TotalRequests' },
                    unit: 'Count',
                    errorCode: 'InternalServerError',
                    timeseries: [],
                },
            ],
        });
        expect(await getAccountHealth(client, '/account', 'Succeeded')).toMatchObject({
            available: false,
            health: undefined,
            reason: 'error',
        });
    });

    it('distinguishes provisioning failures from account-wide throttling', async () => {
        const client = mockClient({ TotalRequests: { value: [{ timeseries: [requests('200', 100)] }] } });
        expect(await getAccountHealth(client, '/account', 'Failed')).toMatchObject({
            health: 'Critical',
            hasSustainedThrottling: false,
        });
        expect(await getAccountHealth(undefined, '/account', 'Failed')).toMatchObject({
            health: 'Critical',
        });
        expect(await getAccountHealth(undefined, '/account', 'Failed')).not.toHaveProperty('hasSustainedThrottling');
    });
});
