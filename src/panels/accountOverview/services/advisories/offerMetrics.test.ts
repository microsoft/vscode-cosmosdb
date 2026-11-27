/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    MonitorClient,
    type MetricValue,
    type Response as MetricsResponse,
    type TimeSeriesElement,
} from '@azure/arm-monitor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { dims, GB, pagedItems, pdims } from '../testFixtures';
import { collectDerivedAdvisories } from './collect';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from './core/thresholds';
import { getContainerIdlePeak } from './fetchers/metrics';

afterEach(() => {
    vi.restoreAllMocks();
});

function fixture(
    mode: 'manual' | 'autoscale',
    activeShared = false,
    deniedMetric?: string,
    databaseAge: 'old' | 'young' | 'unknown' = 'old',
) {
    const credential = {
        getToken: async () => {
            throw new Error('Network access is forbidden in offer metric tests.');
        },
    };
    const cosmosClient = new CosmosDBManagementClient(credential, 'fixture');
    const monitorClient = new MonitorClient(credential, 'fixture');
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    const databaseCreatedAt = databaseAge === 'old' ? createdAt : databaseAge === 'young' ? new Date() : undefined;
    const notFound = Object.assign(new Error('No dedicated offer'), { statusCode: 404 });
    vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({
        systemData: { createdAt },
        locations: [{ locationName: 'East US' }],
    });
    vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
        pagedItems([{ resource: { id: 'mixed-db' }, systemData: { createdAt: databaseCreatedAt } }]),
    );
    vi.spyOn(cosmosClient.sqlResources, 'listSqlContainers').mockImplementation(() =>
        pagedItems(
            ['shared-a', 'shared-b', 'dedicated'].map((id) => ({
                resource: { id, indexingPolicy: { indexingMode: 'none' } },
                systemData: { createdAt },
            })),
        ),
    );
    vi.spyOn(cosmosClient.sqlResources, 'getSqlDatabaseThroughput').mockResolvedValue({
        resource: mode === 'manual' ? { throughput: 4000 } : { autoscaleSettings: { maxThroughput: 4000 } },
    });
    vi.spyOn(cosmosClient.sqlResources, 'getSqlContainerThroughput').mockImplementation(
        async (_rg, _account, _database, container) => {
            if (container !== 'dedicated') {
                throw notFound;
            }
            return {
                resource: mode === 'manual' ? { throughput: 10000 } : { autoscaleSettings: { maxThroughput: 10000 } },
            };
        },
    );

    const points = (field: 'maximum' | 'total' | 'count', value: number): MetricValue[] =>
        Array.from({ length: 24 }, (_, index) => ({
            timeStamp: new Date(Date.UTC(2026, 0, 1, index)),
            [field]: value,
        }));
    const response = (metric: string, timeseries: TimeSeriesElement[]): MetricsResponse => ({
        timespan: '',
        value: [
            { id: 'fixture', type: 'Microsoft.Insights/metrics', name: { value: metric }, unit: 'Count', timeseries },
        ],
    });
    const list = vi.spyOn(monitorClient.metrics, 'list').mockImplementation(async (_resource, options) => {
        const metric = options?.metricnames ?? '';
        const collection = options?.filter?.match(/CollectionName eq '((?:''|[^'])*)'/)?.[1]?.replaceAll("''", "'");
        const regional = options?.filter?.includes("Region eq 'East US'");
        const regionalPoints = (value: number): MetricValue[] => {
            const { bucketMs, windowMs } = DIAGNOSTIC_POLICY.partitionSaturation.observation;
            const start = Date.parse(options?.timespan?.split('/')[0] ?? '');
            return Array.from({ length: windowMs / bucketMs }, (_, index) => ({
                timeStamp: new Date(start + index * bucketMs),
                maximum: value,
            }));
        };
        if (metric === deniedMetric && collection === 'shared-b') {
            throw Object.assign(new Error('Metric access denied'), { statusCode: 403 });
        }
        if (regional && collection === 'dedicated' && metric === 'PhysicalPartitionCount') {
            return response(metric, [{ metadatavalues: dims('mixed-db', collection), data: regionalPoints(2) }]);
        }
        if (metric === 'NormalizedRUConsumption' || metric === 'AutoscaledRU') {
            // Shared throughput has offer-level telemetry, not per-member utilization series.
            if (collection === 'shared-a' || collection === 'shared-b') {
                return response(metric, []);
            }
            const sharedValues = metric === 'AutoscaledRU' ? [200, 200] : [15, 10];
            const dedicatedValues = metric === 'AutoscaledRU' ? [5000, 5000] : [100, 100];
            const values =
                collection === ''
                    ? sharedValues
                    : collection === 'dedicated'
                      ? dedicatedValues
                      : [...sharedValues, ...dedicatedValues];
            return response(
                metric,
                values.map((value, index) => ({
                    metadatavalues: pdims('mixed-db', collection ?? '', 'PhysicalPartitionId', `${index}`),
                    data: regional ? regionalPoints(value) : points('maximum', value),
                })),
            );
        }
        if (metric === 'TotalRequestUnits') {
            const shared = activeShared ? 30 : 0;
            const total = collection === undefined ? 10000 + shared * 2 : collection === 'dedicated' ? 10000 : shared;
            return response(metric, [{ data: points('total', total) }]);
        }
        if (metric === 'TotalRequests') {
            if (options?.filter?.includes('OperationType')) {
                return response(metric, [
                    {
                        metadatavalues: [{ name: { value: 'OperationType' }, value: 'Create' }],
                        data: points('count', 920),
                    },
                ]);
            }
            const counts = collection === undefined ? [2080, 920] : collection === 'dedicated' ? [100, 900] : [990, 10];
            return response(
                metric,
                counts.map((count, index) => ({
                    metadatavalues: dims('mixed-db', collection ?? '', index === 0 ? '200' : '429'),
                    data: points('count', count),
                })),
            );
        }
        return response(metric, [
            {
                metadatavalues: pdims('mixed-db', collection ?? '', 'PhysicalPartitionId', '0'),
                data: points('maximum', metric === 'PhysicalPartitionCount' ? 1 : 10 * GB),
            },
        ]);
    });

    const collect = () =>
        collectDerivedAdvisories({
            monitorClient,
            cosmosClient,
            accountId: 'fixture-account',
            resourceGroup: 'rg',
            accountName: 'acct-prod',
            isServerless: false,
            advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
            accountConfig: {
                accountName: 'acct-prod',
                regionCount: 1,
                writeRegionCount: 1,
                multiRegionWritesEnabled: false,
                api: API.Core,
                backupPolicy: { type: 'Periodic' },
                perRegionPerPartitionAutoscaleEnabled: true,
            },
        });
    return { monitorClient, list, collect };
}

describe('mixed shared and dedicated offer metric acquisition', () => {
    it.each(['young', 'unknown'] as const)(
        'does not use an old account or old members to pass a %s shared database age gate',
        async (age) => {
            const { collect } = fixture('manual', false, undefined, age);
            const result = await collect();

            expect(result.advisories.filter(({ rule }) => rule === 'IdleContainer')).toEqual([]);
            expect(result.detectorCoverage.find(({ rule }) => rule === 'IdleContainer')).toMatchObject({
                status: 'partial',
                evaluatedCount: 1,
                insufficientDataCount: 1,
                matchedCount: 0,
            });
        },
    );

    it.each([false, true])(
        'does not call a shared offer idle when a member has no samples (null=%s)',
        async (allNull) => {
            const { collect, list } = fixture('manual');
            const originalList = list.getMockImplementation()!;
            list.mockImplementation(async (resource, options) => {
                const response = await originalList(resource, options);
                if (options?.metricnames === 'TotalRequestUnits' && options.filter?.includes("'shared-b'")) {
                    for (const metric of response.value) {
                        for (const series of metric.timeseries ?? []) {
                            series.data = allNull ? [{ timeStamp: new Date('2026-01-01') }] : [];
                        }
                    }
                }
                return response;
            });

            const result = await collect();
            expect(result.advisories.filter(({ rule }) => rule === 'IdleContainer')).toEqual([]);
            expect(result.detectorCoverage.find(({ rule }) => rule === 'IdleContainer')).toMatchObject({
                status: 'partial',
                evaluatedCount: 1,
                insufficientDataCount: 1,
                matchedCount: 0,
            });
        },
    );

    it.each(['manual', 'autoscale'] as const)(
        'does not let busy dedicated traffic hide an idle %s shared offer',
        async (mode) => {
            const { collect, list } = fixture(mode);
            const result = await collect();
            expect(result.advisories.filter((advisory) => advisory.rule === 'IdleContainer')).toEqual([
                expect.objectContaining({ scope: 'mixed-db' }),
            ]);
            const idleFilters = list.mock.calls
                .filter(
                    ([, options]) =>
                        options?.metricnames === 'TotalRequestUnits' && options.filter?.includes('DatabaseName'),
                )
                .map(([, options]) => options?.filter);
            expect(idleFilters).toHaveLength(3);
            expect(idleFilters).toEqual(
                expect.arrayContaining([
                    "CollectionName eq 'dedicated' and DatabaseName eq 'mixed-db'",
                    "CollectionName eq 'shared-a' and DatabaseName eq 'mixed-db'",
                    "CollectionName eq 'shared-b' and DatabaseName eq 'mixed-db'",
                ]),
            );
            expect(result.metricSource.failures.filter(({ rule }) => rule === 'IdleContainer')).toEqual([]);
        },
    );

    it.each(['manual', 'autoscale'] as const)(
        'isolates %s utilization and partition/request signals from dedicated siblings',
        async (mode) => {
            const { collect } = fixture(mode, true);
            const result = await collect();
            const sharedRules = result.advisories
                .filter((advisory) => advisory.scope === 'mixed-db')
                .map((advisory) => advisory.rule);
            expect(sharedRules.includes('OverProvisioning')).toBe(mode === 'manual');
            expect(sharedRules).not.toContain('AutoscaleMaxOverProvisioned');
            expect(
                result.metricSource.failures.filter(
                    ({ rule, scope }) => rule === 'AutoscaleMaxOverProvisioned' && scope === 'mixed-db',
                ),
            ).toEqual(
                mode === 'manual' ? [] : [{ rule: 'AutoscaleMaxOverProvisioned', scope: 'mixed-db', reason: 'noData' }],
            );
            expect(sharedRules).not.toContain('IdleContainer');
            expect(sharedRules).not.toContain('SustainedThrottlingInRegion');
            expect(sharedRules).not.toContain('HotPartitionRisk');
            expect(result.advisories).toContainEqual(
                expect.objectContaining({
                    rule: 'SustainedThrottlingInRegion',
                    scope: 'mixed-db/dedicated',
                }),
            );
        },
    );

    it.each(['TotalRequestUnits', 'TotalRequests'])(
        'reports a member failure in %s without a false clean/idle result',
        async (metric) => {
            const { collect } = fixture('manual', false, metric);
            const result = await collect();
            expect(result.metricSource.failures).toContainEqual({
                rule: metric === 'TotalRequestUnits' ? 'IdleContainer' : 'SustainedThrottlingInRegion',
                scope: 'mixed-db',
                reason: 'rbac',
            });
            expect(result.advisories).toContainEqual(
                expect.objectContaining({
                    rule: 'SustainedThrottlingInRegion',
                    scope: 'mixed-db/dedicated',
                }),
            );
            expect(result.advisories.filter((advisory) => advisory.rule === 'IdleContainer')).toHaveLength(
                metric === 'TotalRequestUnits' ? 0 : 1,
            );
        },
    );

    it.each([
        { indexes: [0, 1], matching: true, peak: 40 },
        { indexes: [0, 1], matching: false, peak: 80 },
        { indexes: [1, 2], matching: true, peak: undefined },
    ])('only sums complete aligned member buckets: %j', async ({ indexes, matching, peak }) => {
        const { monitorClient, list } = fixture('manual');
        list.mockImplementation(async (_resource, options) => ({
            timespan: '',
            value: [
                {
                    id: 'fixture',
                    type: 'Microsoft.Insights/metrics',
                    name: { value: 'TotalRequestUnits' },
                    unit: 'Count',
                    timeseries: [
                        {
                            data: (options?.filter?.includes("'shared-a'") ? [0, 1] : indexes).map((index) => ({
                                timeStamp: new Date(Date.UTC(2026, 0, 1, index)),
                                total: !matching || options?.filter?.includes("'shared-a'") === (index === 0) ? 40 : 0,
                            })),
                        },
                    ],
                },
            ],
        }));
        expect(
            await getContainerIdlePeak(monitorClient, 'fixture', 'mixed-db', undefined, undefined, [
                'shared-a',
                'shared-b',
                'shared-a',
            ]),
        ).toBe(peak);
    });

    it('requires membership and does not discover containers through a database-wide idle query', async () => {
        const { monitorClient, list } = fixture('manual');
        await expect(getContainerIdlePeak(monitorClient, 'fixture', 'mixed-db', undefined)).rejects.toThrow(
            'authoritative container membership',
        );
        expect(
            await getContainerIdlePeak(monitorClient, 'fixture', 'mixed-db', undefined, undefined, []),
        ).toBeUndefined();
        expect(list).not.toHaveBeenCalled();
    });
});
