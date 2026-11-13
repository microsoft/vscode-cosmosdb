/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    MonitorClient,
    type Metric,
    type MetricsListOptionalParams,
    type Response as MetricsResponse,
    type TimeSeriesElement,
} from '@azure/arm-monitor';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dims } from '../../testFixtures';
import { getBackupCostEstimate } from './backupCost';
import { type CostContext } from './costManagement';

const now = Date.parse('2026-11-11T12:00:00Z');
const timestamp = new Date(now - 300_000);
const accountId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
const context: CostContext = {
    subscriptionId: 'sub',
    resourceManagerEndpoint: 'https://management.azure.com',
    locationNames: ['East US', 'West US'],
};
const rows = [
    { databaseId: 'db', containerId: 'items' },
    { databaseId: 'db', containerId: 'other' },
];

function storageSeries(container: string, total = 1_000_000_000, database = 'db'): TimeSeriesElement {
    return {
        metadatavalues: [...dims(database, container), { name: { value: 'Region' }, value: 'East US' }],
        data: [{ timeStamp: timestamp, total }],
    };
}

function metric(series: TimeSeriesElement[], overrides: Partial<Metric> = {}): MetricsResponse {
    return {
        timespan: '',
        value: [
            {
                id: 'data',
                type: 'Microsoft.Insights/metrics',
                name: { value: 'DataUsageV2' },
                unit: 'Bytes',
                timeseries: series,
                ...overrides,
            },
        ],
    };
}

function filteredStorage(series: TimeSeriesElement[], options?: MetricsListOptionalParams): MetricsResponse {
    const dimensions = new Map<string, string[]>();
    for (const [, dimension, literal] of (options?.filter ?? '').matchAll(
        /(DatabaseName|CollectionName|Region) eq '((?:''|[^'])*)'/g,
    )) {
        const values = dimensions.get(dimension) ?? [];
        values.push(literal.replace(/''/g, "'").toLowerCase());
        dimensions.set(dimension, values);
    }
    return metric(
        series
            .filter((entry) =>
                [...dimensions].every(([dimension, values]) => {
                    const value = entry.metadatavalues
                        ?.find((metadata) => metadata.name?.value === dimension)
                        ?.value?.toLowerCase();
                    return values.includes('*') || (value !== undefined && values.includes(value));
                }),
            )
            .slice(0, options?.top ?? 10),
    );
}

function retailItem(region: string, overrides: Record<string, unknown> = {}) {
    return {
        armRegionName: region,
        serviceName: 'Azure Cosmos DB',
        productName: 'Azure Cosmos DB - PITR',
        skuName: 'Backup',
        meterName: 'Cont 30D Bckp Continuous Backup',
        type: 'Consumption',
        unitOfMeasure: '1 GB',
        tierMinimumUnits: 0,
        isPrimaryMeterRegion: true,
        currencyCode: 'USD',
        retailPrice: 0.2,
        meterId: `meter-${region}`,
        effectiveStartDate: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

function page(items = [retailItem('eastus'), retailItem('westus')], next: string | null = null) {
    return { BillingCurrency: 'USD', Items: items, NextPageLink: next };
}

function setup() {
    const cosmos = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
    const send = vi.spyOn(cosmos.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
        request,
        status: 200,
        headers: createHttpHeaders(),
        bodyAsText: JSON.stringify({
            value: [
                { name: 'eastus', displayName: 'East US' },
                { name: 'westus', displayName: 'West US' },
            ],
        }),
    }));
    const monitor = new MonitorClient({ getToken: async () => null }, 'sub');
    const list = vi
        .spyOn(monitor.metrics, 'list')
        .mockResolvedValue(metric(rows.map((row) => storageSeries(row.containerId))));
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(page())));
    vi.stubGlobal('fetch', fetchMock);
    const read = (overrides: Partial<CostContext> = {}, inventory = rows) =>
        getBackupCostEstimate(cosmos, monitor, { ...context, ...overrides }, accountId, inventory, now);
    return { cosmos, monitor, send, list, fetchMock, read };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('paid continuous-backup retail scenario', () => {
    it.each(['eastus', 'EASTUS', 'East US'])(
        'uses the resolved Monitor display name for the accepted alias %s',
        async (alias) => {
            const { read, list } = setup();
            list.mockImplementation(async (_id, options) =>
                metric(
                    options?.filter?.includes("Region eq 'East US'")
                        ? rows
                              .filter((row) => options.filter?.includes(`CollectionName eq '${row.containerId}'`))
                              .map((row) => storageSeries(row.containerId))
                        : [],
                ),
            );
            expect(await read({ locationNames: [alias, 'westus'] })).toMatchObject({
                storageBytes: 2_000_000_000,
                referenceRegion: 'East US',
                monthlyAmount: 0.8,
            });
            expect(list.mock.calls[0][1]?.filter).toContain("Region eq 'East US'");
        },
    );

    it.each([
        { databaseId: 'orders', containerId: 'items' },
        { databaseId: 'ORDERS', containerId: 'ITEMS' },
    ])('accepts metric dimension values with different casing from inventory: %j', async (observed) => {
        const { read, list } = setup();
        list.mockResolvedValue(
            metric([
                {
                    ...storageSeries('items'),
                    metadatavalues: [
                        ...dims(observed.databaseId, observed.containerId),
                        { name: { value: 'Region' }, value: 'East US' },
                    ],
                },
            ]),
        );
        await expect(read({}, [{ databaseId: 'Orders', containerId: 'Items' }])).resolves.toMatchObject({
            storageBytes: 1_000_000_000,
            logicalContainers: 1,
            monthlyAmount: 0.4,
        });
    });

    it.each([
        { databaseId: 'DB', containerId: 'items' },
        { databaseId: 'db', containerId: 'ITEMS' },
    ])('rejects case-folded inventory collisions before reading metrics: %j', async (duplicate) => {
        const { read, list, fetchMock } = setup();
        await expect(read({}, [rows[0], duplicate])).rejects.toMatchObject({ kind: 'invalidData' });
        expect(list).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not count differently cased copies of the same metric identity twice', async () => {
        const { read, list, fetchMock } = setup();
        list.mockResolvedValue(
            metric([
                storageSeries('items'),
                {
                    ...storageSeries('items'),
                    metadatavalues: [...dims('DB', 'ITEMS'), { name: { value: 'Region' }, value: 'East US' }],
                },
            ]),
        );
        await expect(read({}, [rows[0]])).rejects.toMatchObject({ kind: 'noData' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([false, true])('classifies malformed retail JSON as invalid evidence (later page=%s)', async (later) => {
        const { read, fetchMock } = setup();
        if (later) {
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify(page([retailItem('eastus')], 'https://prices.azure.com/api/retail/prices?$skip=1')),
                ),
            );
        }
        fetchMock.mockResolvedValueOnce(new Response('{"Items":'));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        expect(fetchMock).toHaveBeenCalledTimes(later ? 2 : 1);
    });

    it('does not reclassify a retail transport failure as invalid JSON', async () => {
        const { read, fetchMock } = setup();
        const failure = new TypeError('Transport failed');
        fetchMock.mockRejectedValueOnce(failure);
        await expect(read()).rejects.toBe(failure);
    });

    it('reads a complete dimension-split storage snapshot in one request, with current prices for every region', async () => {
        const { read, list, send, fetchMock } = setup();
        const result = await read();
        expect(result).toMatchObject({
            basis: 'azureRetailPrice',
            currency: 'USD',
            monthlyAmount: 0.8,
            storageBytes: 2_000_000_000,
            logicalContainers: 2,
            referenceRegion: 'East US',
            snapshotAt: timestamp.toISOString(),
            prices: [
                { region: 'eastus', perGbMonth: 0.2, meterId: 'meter-eastus' },
                { region: 'westus', perGbMonth: 0.2, meterId: 'meter-westus' },
            ],
        });
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][1].url).toContain('/subscriptions/sub/locations?api-version=');
        expect(list).toHaveBeenCalledExactlyOnceWith(accountId, {
            metricnames: 'DataUsageV2',
            aggregation: 'Total',
            interval: 'PT5M',
            timespan: '2026-11-10T12:00:00.000Z/2026-11-11T12:00:00.000Z',
            filter: "DatabaseName eq 'db' and (CollectionName eq 'items' or CollectionName eq 'other') and Region eq 'East US'",
            top: 2,
        });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(/^https:\/\/prices\.azure\.com\/api\/retail\/prices\?/),
            expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
        );
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('headers');
    });

    it('matches lowercased Monitor dimensions to the original ARM inventory identities', async () => {
        const { read, list } = setup();
        expect(
            await read({}, [
                { databaseId: 'Db', containerId: 'Items' },
                { databaseId: 'DB', containerId: 'Other' },
            ]),
        ).toMatchObject({ storageBytes: 2_000_000_000, logicalContainers: 2, monthlyAmount: 0.8 });
        expect(list).toHaveBeenCalledOnce();
    });

    it('excludes a recently deleted container before it can consume a limited series slot', async () => {
        const { read, list } = setup();
        const historical = [
            storageSeries('deleted', 99_000_000_000),
            ...rows.map((row) => storageSeries(row.containerId)),
        ];
        list.mockImplementation(async (_id, options) => filteredStorage(historical, options));
        expect(await read()).toMatchObject({
            storageBytes: 2_000_000_000,
            logicalContainers: 2,
            monthlyAmount: 0.8,
        });
        expect(list).toHaveBeenCalledOnce();
        expect(list.mock.calls[0][1]?.filter).not.toContain("CollectionName eq '*'");
    });

    it('keeps identically named containers in different databases separate', async () => {
        const { read, list } = setup();
        const inventory = [
            { databaseId: 'db', containerId: 'items' },
            { databaseId: 'another-db', containerId: 'items' },
        ];
        list.mockImplementation(async (_id, options) =>
            filteredStorage(
                inventory.map((row) => storageSeries(row.containerId, 1_000_000_000, row.databaseId)),
                options,
            ),
        );
        expect(await read({}, inventory)).toMatchObject({ storageBytes: 2_000_000_000, logicalContainers: 2 });
        expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls.map((call) => call[1]?.filter)).toEqual([
            "DatabaseName eq 'db' and (CollectionName eq 'items') and Region eq 'East US'",
            "DatabaseName eq 'another-db' and (CollectionName eq 'items') and Region eq 'East US'",
        ]);
    });

    it('does not request deleted cross-product identities from containers in different databases', async () => {
        const { read, list } = setup();
        const inventory = [
            { databaseId: 'db', containerId: 'items' },
            { databaseId: 'other-db', containerId: 'other' },
        ];
        const series = [
            storageSeries('other', 99_000_000_000, 'db'),
            storageSeries('items', 99_000_000_000, 'other-db'),
            ...inventory.map((row) => storageSeries(row.containerId, 1_000_000_000, row.databaseId)),
        ];
        list.mockImplementation(async (_id, options) => filteredStorage(series, options));
        expect(await read({}, inventory)).toMatchObject({ storageBytes: 2_000_000_000, logicalContainers: 2 });
        expect(list).toHaveBeenCalledTimes(2);
        for (const [, options] of list.mock.calls) {
            expect(options?.filter?.match(/DatabaseName eq /g)).toHaveLength(1);
            expect(options?.top).toBe(1);
        }
    });

    it('escapes database, container and reference-region literals without broadening the filter', async () => {
        const { read, list, send } = setup();
        const inventory = [{ databaseId: "db'quoted", containerId: "items'quoted" }];
        const series = storageSeries("items'quoted", 1_000_000_000, "db'quoted");
        series.metadatavalues = [
            ...dims("db'quoted", "items'quoted"),
            { name: { value: 'Region' }, value: "East 'US" },
        ];
        list.mockResolvedValue(metric([series]));
        send.mockImplementation(async (_http, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify({ value: [{ name: 'eastus', displayName: "East 'US" }] }),
        }));
        expect(await read({ locationNames: ["East 'US"] }, inventory)).toMatchObject({ storageBytes: 1_000_000_000 });
        expect(list.mock.calls[0][1]?.filter).toBe(
            "DatabaseName eq 'db''quoted' and (CollectionName eq 'items''quoted') and Region eq 'East ''US'",
        );
    });

    it.each([
        [
            { databaseId: 'db', containerId: 'items' },
            { databaseId: 'db', containerId: 'Items' },
        ],
        [
            { databaseId: 'db', containerId: 'items' },
            { databaseId: 'Db', containerId: 'items' },
        ],
    ])('rejects inventory identities that are ambiguous after Monitor case folding: %j', async (...inventory) => {
        const { read, list, fetchMock } = setup();
        await expect(read({}, inventory)).rejects.toMatchObject({ kind: 'invalidData' });
        expect(list).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('chooses a common complete timestamp, not per-container latest values or sums of time buckets', async () => {
        const { read, list } = setup();
        const series = storageSeries('items');
        series.data?.push({
            timeStamp: new Date(now),
            total: 99_000_000_000,
        });
        list.mockResolvedValue(metric([series, storageSeries('other')]));
        expect(await read()).toMatchObject({ monthlyAmount: 0.8, snapshotAt: timestamp.toISOString() });
    });

    it('retains observed zero storage but never replaces missing storage with zero', async () => {
        const { read, list } = setup();
        list.mockResolvedValue(metric(rows.map((row) => storageSeries(row.containerId, 0))));
        expect(await read()).toMatchObject({ monthlyAmount: 0, storageBytes: 0 });
        list.mockResolvedValue(metric([]));
        await expect(read()).rejects.toMatchObject({ kind: 'noData' });
    });

    it.each([
        ['non-byte unit', (series: TimeSeriesElement) => metric([series], { unit: 'Count' })],
        ['embedded error', (series: TimeSeriesElement) => metric([series], { errorCode: 'Forbidden' })],
        ['negative bytes', () => metric([storageSeries('items', -1)])],
        ['non-finite bytes', () => metric([storageSeries('items', Infinity)])],
        [
            'invalid timestamp',
            () => metric([{ ...storageSeries('items'), data: [{ timeStamp: new Date(NaN), total: 1 }] }]),
        ],
        ['wrong container', () => metric([storageSeries('unexpected')])],
        ['duplicate identity', (series: TimeSeriesElement) => metric([series, series, storageSeries('other')])],
        [
            'case-folded duplicate identity',
            (series: TimeSeriesElement) =>
                metric([
                    series,
                    {
                        ...series,
                        metadatavalues: [...dims('DB', 'ITEMS'), { name: { value: 'Region' }, value: 'East US' }],
                    },
                    storageSeries('other'),
                ]),
        ],
        [
            'wrong region',
            (series: TimeSeriesElement) =>
                metric([
                    {
                        ...series,
                        metadatavalues: [...dims('db', 'items'), { name: { value: 'Region' }, value: 'West US' }],
                    },
                ]),
        ],
    ] as const)('rejects %s without querying prices', async (_name, response) => {
        const { read, list, fetchMock } = setup();
        list.mockResolvedValue(response(storageSeries('items')));
        await expect(read()).rejects.toBeInstanceOf(Error);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([-6 * 3_600_000 - 1, 300_001])('rejects stale/future common snapshots at offset %s', async (offset) => {
        const { read, list } = setup();
        list.mockResolvedValue(
            metric(
                rows.map((row) => ({
                    ...storageSeries(row.containerId),
                    data: [{ timeStamp: new Date(now + offset), total: 1 }],
                })),
            ),
        );
        await expect(read()).rejects.toBeInstanceOf(Error);
    });

    it('accepts the exact freshness and future-skew boundaries', async () => {
        const { read, list } = setup();
        for (const offset of [-6 * 3_600_000, 300_000]) {
            list.mockResolvedValue(
                metric(
                    rows.map((row) => ({
                        ...storageSeries(row.containerId),
                        data: [{ timeStamp: new Date(now + offset), total: 1 }],
                    })),
                ),
            );
            expect(await read()).toMatchObject({ snapshotAt: new Date(now + offset).toISOString() });
        }
    });

    it.each([
        { locationNames: [] },
        { locationNames: ['East US', 'unknown'] },
        { locationNames: ['East US', 'eastus'] },
        { locationNames: ['East US', ''] },
    ])('requires complete unambiguous account-region mapping: %j', async (overrides) => {
        const { read, list, fetchMock } = setup();
        await expect(read(overrides)).rejects.toMatchObject({ kind: 'invalidData' });
        expect(list).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects ambiguous location aliases', async () => {
        const { read, send } = setup();
        send.mockImplementation(async (_http, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify({
                value: [
                    { name: 'eastus', displayName: 'East US' },
                    { name: 'other', displayName: 'East US' },
                ],
            }),
        }));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
    });

    it('rejects incomplete location metadata instead of pricing only the visible subset', async () => {
        const { read, send, fetchMock } = setup();
        send.mockImplementation(async (_http, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify({
                value: [
                    { name: 'eastus', displayName: 'East US' },
                    { name: 'westus', displayName: 'West US' },
                ],
                nextLink: 'https://management.azure.com/next',
            }),
        }));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requests every inventory series explicitly beyond the default ten-series limit in one call', async () => {
        const { read, list } = setup();
        const inventory = Array.from({ length: 13 }, (_, index) => ({ databaseId: 'db', containerId: `c${index}` }));
        list.mockImplementation(async (_id, options) =>
            metric(inventory.slice(0, options?.top ?? 10).map((row) => storageSeries(row.containerId))),
        );
        expect(await read({}, inventory)).toMatchObject({
            storageBytes: 13_000_000_000,
            logicalContainers: 13,
            monthlyAmount: 5.2,
        });
        expect(list).toHaveBeenCalledExactlyOnceWith(
            accountId,
            expect.objectContaining({
                top: 13,
                filter:
                    "DatabaseName eq 'db' and (" +
                    inventory.map((row) => `CollectionName eq '${row.containerId}'`).join(' or ') +
                    ") and Region eq 'East US'",
            }),
        );
    });

    it('bounds large inventories and requires a common timestamp across all batches', async () => {
        const { read, list } = setup();
        const inventory = Array.from({ length: 45 }, (_, index) => ({ databaseId: 'db', containerId: `c${index}` }));
        const series = inventory.map((row) => ({
            ...storageSeries(row.containerId),
            data: [
                { timeStamp: timestamp, total: 1_000_000_000 },
                { timeStamp: new Date(now), total: row.containerId === 'c44' ? undefined : 99_000_000_000 },
            ],
        }));
        list.mockImplementation(async (_id, options) => filteredStorage(series, options));
        expect(await read({}, inventory)).toMatchObject({
            storageBytes: 45_000_000_000,
            logicalContainers: 45,
            snapshotAt: timestamp.toISOString(),
        });
        expect(list.mock.calls.map((call) => call[1]?.top)).toEqual([20, 20, 5]);
        for (const [, options] of list.mock.calls) {
            expect(options?.filter?.match(/CollectionName eq /g)).toHaveLength(options?.top ?? 0);
            expect(new URLSearchParams({ $filter: options?.filter ?? '' }).toString().length).toBeLessThanOrEqual(4096);
        }
    });

    it('reads 25 databases in five concurrent waves instead of 25 serial round trips', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(now);
            const { read, list } = setup();
            const inventory = Array.from({ length: 25 }, (_, index) => ({
                databaseId: `db${index}`,
                containerId: 'items',
            }));
            const series = inventory.map((row) => storageSeries(row.containerId, 1_000_000_000, row.databaseId));
            let active = 0;
            let peak = 0;
            const starts: number[] = [];
            list.mockImplementation(async (_id, options) => {
                active++;
                peak = Math.max(peak, active);
                starts.push(Date.now() - now);
                await new Promise<void>((resolve) => setTimeout(resolve, 10));
                active--;
                return filteredStorage(series, options);
            });
            const pending = read({}, inventory);
            await vi.runAllTimersAsync();
            expect(await pending).toMatchObject({
                storageBytes: 25_000_000_000,
                logicalContainers: 25,
                snapshotAt: timestamp.toISOString(),
            });
            expect(peak).toBe(5);
            expect(active).toBe(0);
            expect(starts).toEqual(Array.from({ length: 25 }, (_, index) => Math.floor(index / 5) * 10));
        } finally {
            vi.useRealTimers();
        }
    });

    it('combines out-of-order waves only at a complete common timestamp', async () => {
        vi.useFakeTimers();
        try {
            const { read, list } = setup();
            const inventory = Array.from({ length: 7 }, (_, index) => ({
                databaseId: `db${index}`,
                containerId: 'items',
            }));
            const series = inventory.map((row, index) => ({
                ...storageSeries(row.containerId, 1_000_000_000, row.databaseId),
                data: [
                    { timeStamp: timestamp, total: 1_000_000_000 },
                    { timeStamp: new Date(now), total: index === 6 ? undefined : 99_000_000_000 },
                ],
            }));
            let started = 0;
            const completed: number[] = [];
            list.mockImplementation(async (_id, options) => {
                const index = started++;
                await new Promise<void>((resolve) => setTimeout(resolve, (5 - (index % 5)) * 10));
                completed.push(index);
                return filteredStorage(series, options);
            });
            const pending = read({}, inventory);
            await vi.runAllTimersAsync();
            expect(await pending).toMatchObject({
                storageBytes: 7_000_000_000,
                logicalContainers: 7,
                snapshotAt: timestamp.toISOString(),
            });
            expect(completed).toEqual([4, 3, 2, 1, 0, 6, 5]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not start another wave or query prices when a concurrent request fails', async () => {
        vi.useFakeTimers();
        try {
            const { read, list, fetchMock } = setup();
            const inventory = Array.from({ length: 12 }, (_, index) => ({
                databaseId: `db${index}`,
                containerId: 'items',
            }));
            const series = inventory.map((row) => storageSeries(row.containerId, 1_000_000_000, row.databaseId));
            const failure = new Error('Storage request failed.');
            let started = 0;
            let completed = 0;
            list.mockImplementation(async (_id, options) => {
                const index = started++;
                await new Promise<void>((resolve) => setTimeout(resolve, index === 0 ? 1 : 10));
                completed++;
                if (index === 0) {
                    throw failure;
                }
                return filteredStorage(series, options);
            });
            const pending = read({}, inventory).then(
                () => undefined,
                (error: unknown) => error,
            );
            await vi.runAllTimersAsync();
            expect(await pending).toBe(failure);
            expect(list).toHaveBeenCalledTimes(5);
            expect(completed).toBe(5);
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('bounds URL-encoded filters even when long escaped names fit in fewer than twenty terms', async () => {
        const { read, list } = setup();
        const inventory = Array.from({ length: 13 }, (_, index) => ({
            databaseId: 'db',
            containerId: `${"'".repeat(240)}${index}`,
        }));
        const series = inventory.map((row) => storageSeries(row.containerId));
        list.mockImplementation(async (_id, options) => filteredStorage(series, options));
        expect(await read({}, inventory)).toMatchObject({ storageBytes: 13_000_000_000, logicalContainers: 13 });
        expect(list.mock.calls.length).toBeGreaterThan(1);
        for (const [, options] of list.mock.calls) {
            expect(new URLSearchParams({ $filter: options?.filter ?? '' }).toString().length).toBeLessThanOrEqual(4096);
        }
        expect(list.mock.calls.reduce((sum, call) => sum + (call[1]?.top ?? 0), 0)).toBe(inventory.length);
    });

    it.each(['missing', 'disjoint', 'failure', 'wrong batch'] as const)(
        'never prices partial inventory when a later batch has %s evidence',
        async (failure) => {
            const { read, list, fetchMock } = setup();
            const inventory = Array.from({ length: 21 }, (_, index) => ({
                databaseId: 'db',
                containerId: `c${index}`,
            }));
            const series = inventory.map((row) => storageSeries(row.containerId));
            list.mockImplementationOnce(async (_id, options) => filteredStorage(series, options));
            if (failure === 'failure') {
                list.mockRejectedValueOnce(new Error('Metrics unavailable.'));
            } else {
                const last = storageSeries('c20');
                if (failure === 'disjoint') {
                    last.data = [{ timeStamp: new Date(now), total: 1_000_000_000 }];
                }
                list.mockResolvedValueOnce(
                    metric(failure === 'missing' ? [] : failure === 'wrong batch' ? [series[0]] : [last]),
                );
            }
            await expect(read({}, inventory)).rejects.toBeInstanceOf(Error);
            expect(list).toHaveBeenCalledTimes(2);
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );

    it.each([
        { databaseId: '*', containerId: 'items' },
        { databaseId: 'db', containerId: '*' },
        { databaseId: 'db', containerId: "'".repeat(1000) },
    ])('does not issue wildcard or oversized inventory filters: %j', async (row) => {
        const { read, list, fetchMock } = setup();
        await expect(read({}, [row])).rejects.toMatchObject({ kind: 'unsupported' });
        expect(list).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([0, 1, 10])(
        'rejects a truncated snapshot of %i out of thirteen containers without pricing it',
        async (count) => {
            const { read, list, fetchMock } = setup();
            const inventory = Array.from({ length: 13 }, (_, index) => ({
                databaseId: 'db',
                containerId: `c${index}`,
            }));
            list.mockResolvedValue(metric(inventory.slice(0, count).map((row) => storageSeries(row.containerId))));
            await expect(read({}, inventory)).rejects.toMatchObject({ kind: 'noData' });
            expect(list).toHaveBeenCalledOnce();
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );

    it('fails closed without complete inventory and on duplicate container identities', async () => {
        const { read, cosmos, monitor } = setup();
        await expect(read({}, [])).rejects.toMatchObject({ kind: 'noData' });
        await expect(read({}, [rows[0], rows[0]])).rejects.toMatchObject({ kind: 'invalidData' });
        await expect(getBackupCostEstimate(cosmos, monitor, context, accountId, undefined, now)).rejects.toMatchObject({
            kind: 'noData',
        });
    });

    it('does not use public retail pricing for sovereign clouds', async () => {
        const { read, send, fetchMock } = setup();
        await expect(read({ resourceManagerEndpoint: 'https://management.usgovcloudapi.net' })).rejects.toMatchObject({
            kind: 'unsupported',
        });
        expect(send).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        { retailPrice: -1 },
        { retailPrice: '0.2' },
        { retailPrice: null },
        { currencyCode: 'EUR' },
        { meterId: '' },
        { effectiveStartDate: 'invalid' },
        { effectiveStartDate: '2026-01-01T00:00:00' },
        { effectiveEndDate: '2025-01-01T00:00:00Z' },
    ])('rejects malformed matching price records: %j', async (overrides) => {
        const { read, fetchMock } = setup();
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify(page([retailItem('eastus', overrides), retailItem('westus')]))),
        );
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
    });

    it.each([
        { meterName: 'Restore' },
        { meterName: 'Cont 7D Bckp Continuous Backup' },
        { unitOfMeasure: '1 GiB' },
        { skuName: 'Other' },
        { type: 'Reservation' },
        { isPrimaryMeterRegion: false },
        { tierMinimumUnits: 1 },
        { effectiveStartDate: '2027-01-01T00:00:00Z' },
        { effectiveEndDate: '2026-11-11T12:00:00Z' },
    ])('does not substitute a near-match, future or expired price: %j', async (overrides) => {
        const { read, fetchMock } = setup();
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify(page([retailItem('eastus', overrides), retailItem('westus')]))),
        );
        await expect(read()).rejects.toMatchObject({ kind: 'noData' });
    });

    it('rejects duplicate current prices and mixed response currency', async () => {
        const { read, fetchMock } = setup();
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify(page([retailItem('eastus'), retailItem('eastus'), retailItem('westus')]))),
        );
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...page(), BillingCurrency: 'EUR' })));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
    });

    it('follows valid same-endpoint pagination without authenticating retail requests', async () => {
        const { read, fetchMock } = setup();
        const next = 'https://prices.azure.com/api/retail/prices?$skip=100';
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page([retailItem('eastus')], next))));
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page([retailItem('westus')]))));
        expect(await read()).toMatchObject({ monthlyAmount: 0.8 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe(next);
    });

    it.each([
        'http://prices.azure.com/api/retail/prices',
        'https://other.invalid/api/retail/prices',
        'https://prices.azure.com/other',
        'https://user:password@prices.azure.com/api/retail/prices',
    ])('rejects pagination outside the fixed HTTPS endpoint: %s', async (next) => {
        const { read, fetchMock } = setup();
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page([retailItem('eastus')], next))));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects pagination loops and HTTP failures instead of returning partial prices', async () => {
        const { read, fetchMock } = setup();
        const next = 'https://prices.azure.com/api/retail/prices?$skip=100';
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page([retailItem('eastus')], next))));
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(page([], next))));
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        fetchMock.mockResolvedValueOnce(new Response('private response', { status: 429 }));
        await expect(read()).rejects.toMatchObject({ statusCode: 429 });
    });

    it('bounds retail pagination even when every next link is distinct', async () => {
        const { read, fetchMock } = setup();
        let index = 0;
        fetchMock.mockImplementation(
            async () =>
                new Response(JSON.stringify(page([], `https://prices.azure.com/api/retail/prices?$skip=${++index}`))),
        );
        await expect(read()).rejects.toMatchObject({ kind: 'invalidData' });
        expect(fetchMock).toHaveBeenCalledTimes(20);
    });
});
