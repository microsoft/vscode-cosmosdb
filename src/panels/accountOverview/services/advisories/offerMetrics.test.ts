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
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import { getContainerIdlePeak } from './fetchers/metrics';

afterEach(() => {
    vi.restoreAllMocks();
});

function fixture(mode: 'manual' | 'autoscale', activeShared = false, deniedMetric?: string) {
    const credential = {
        getToken: async () => {
            throw new Error('Network access is forbidden in offer metric tests.');
        },
    };
    const cosmosClient = new CosmosDBManagementClient(credential, 'fixture');
    const monitorClient = new MonitorClient(credential, 'fixture');
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    const notFound = Object.assign(new Error('No dedicated offer'), { statusCode: 404 });
    vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({ systemData: { createdAt } });
    vi.spyOn(cosmosClient.sqlResources, 'listSqlDatabases').mockImplementation(() =>
        pagedItems([{ resource: { id: 'mixed-db' }, systemData: { createdAt } }]),
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
        if (metric === deniedMetric && collection === 'shared-b') {
            throw Object.assign(new Error('Metric access denied'), { statusCode: 403 });
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
                    data: points('maximum', value),
                })),
            );
        }
        if (metric === 'TotalRequestUnits') {
            const shared = activeShared ? 30 : 0;
            const total = collection === undefined ? 10000 + shared * 2 : collection === 'dedicated' ? 10000 : shared;
            return response(metric, [{ data: points('total', total) }]);
        }
        if (metric === 'TotalRequests') {
            const counts = collection === undefined ? [2080, 920] : collection === 'dedicated' ? [100, 900] : [990, 10];
            return response(
                metric,
                counts.map((count, index) => ({
                    metadatavalues: options?.filter?.includes('OperationType')
                        ? [{ name: { value: 'OperationType' }, value: index === 0 ? 'Read' : 'Create' }]
                        : dims('mixed-db', collection ?? '', index === 0 ? '200' : '429'),
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
            expect(result.metricSource).toEqual({ available: true, failures: [] });
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
            expect(sharedRules).toContain(mode === 'manual' ? 'OverProvisioning' : 'AutoscaleMaxOverProvisioned');
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

    it('sums aligned member buckets before taking the idle peak', async () => {
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
                            data: [0, 1].map((index) => ({
                                timeStamp: new Date(Date.UTC(2026, 0, 1, index)),
                                total:
                                    options?.filter?.includes("CollectionName eq 'shared-a'") === (index === 0)
                                        ? 40
                                        : 0,
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
        ).toBe(40);
    });

    it('requires membership and does not discover containers through a database-wide idle query', async () => {
        const { monitorClient, list } = fixture('manual');
        await expect(getContainerIdlePeak(monitorClient, 'fixture', 'mixed-db', undefined)).rejects.toThrow(
            'authoritative container membership',
        );
        expect(await getContainerIdlePeak(monitorClient, 'fixture', 'mixed-db', undefined, undefined, [])).toBe(0);
        expect(list).not.toHaveBeenCalled();
    });
});
