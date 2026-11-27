/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { dims, pagedItems } from '../../testFixtures';
import { DAY } from '../../units';
import { collectDerivedAdvisories } from '../collect';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisoryRule } from '../core/types';
import { enrichAdvisoryCosts, recoverableCapacity } from '../costEstimates';
import { autoscaleMaxOverProvisionedDetector } from '../detectors/AutoscaleMaxOverProvisionedDetector';
import { idleContainerDetector } from '../detectors/IdleContainerDetector';
import { multiRegionWriteAntipatternDetector } from '../detectors/MultiRegionWriteAntipatternDetector';
import { overProvisioningDetector } from '../detectors/OverProvisioningDetector';
import { throttlingByOperationDetector } from '../detectors/ThrottlingByOperationDetector';
import { metricResponse, withMetrics } from './metricsFixture';
import { near, number, observation, type Binding, type World } from './shared';

const accountId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/fixture';
const costContext = {
    subscriptionId: 'sub',
    resourceManagerEndpoint: 'https://management.azure.com',
    locationNames: ['East US'],
};
const noToken = {
    getToken: async () => {
        throw new Error('Network access is forbidden in CODA conformance.');
    },
};
const denied = () => Object.assign(new Error('Fixture Monitor denied the read.'), { statusCode: 403 });
const binding =
    (type: Binding['type']) =>
    (pattern: RegExp, execute: Binding['execute']): Binding => ({
        type,
        pattern,
        execute,
    });
const given = binding('Context');
const when = binding('Action');
const then = binding('Outcome');

function armAge(age: string | undefined, now: number) {
    if (!age || age === 'unknown') {
        return {};
    }
    if (age.startsWith('modified-')) {
        return { lastModifiedAt: new Date(now - number(age.slice('modified-'.length)) * DAY) };
    }
    return { createdAt: new Date(now - number(age) * DAY) };
}

async function collectFixture(world: World, mode: 'idle' | 'operations' | 'indexing' | 'backup'): Promise<void> {
    const now = Date.now();
    const cosmos = new CosmosDBManagementClient(noToken, 'sub');
    const count = world.backupStorage?.total ?? world.indexingBatch ?? 1;
    const ids =
        mode === 'idle' && world.pool ? ['a', 'b', 'dedicated'] : Array.from({ length: count }, (_, i) => `c${i}`);
    const serverless = mode !== 'idle';
    const retainedSpies: { mockRestore(): void }[] = [
        vi
            .spyOn(cosmos.databaseAccounts, 'get')
            .mockResolvedValue({ systemData: { createdAt: new Date(now - 365 * DAY) } }),
        vi.spyOn(cosmos.sqlResources, 'listSqlDatabases').mockImplementation(() =>
            pagedItems(
                ids.length
                    ? [
                          {
                              resource: { id: 'db' },
                              systemData: world.pool?.malformedAge
                                  ? { createdAt: new Date(NaN) }
                                  : armAge(world.pool?.databaseAge, now),
                          },
                      ]
                    : [],
            ),
        ),
        vi.spyOn(cosmos.sqlResources, 'listSqlContainers').mockImplementation(() =>
            pagedItems(
                ids.map((id) => ({
                    resource: {
                        id,
                        indexingPolicy: {
                            indexingMode: mode === 'indexing' && !world.storageDenied ? 'consistent' : 'none',
                        },
                    },
                    systemData: armAge(world.pool?.containerAge ?? '30', now),
                })),
            ),
        ),
        vi.spyOn(cosmos.sqlResources, 'getSqlDatabaseThroughput').mockImplementation(async () => {
            if (!world.pool) {
                throw Object.assign(new Error('No shared offer.'), { statusCode: 404 });
            }
            return { resource: { throughput: 1000 } };
        }),
        vi
            .spyOn(cosmos.sqlResources, 'getSqlContainerThroughput')
            .mockImplementation(async (_rg, _name, _db, container) => {
                if (world.pool && container !== 'dedicated') {
                    throw Object.assign(new Error('No dedicated offer.'), { statusCode: 404 });
                }
                return { resource: { throughput: 1000 } };
            }),
    ];
    if (mode === 'backup') {
        retainedSpies.push(
            vi.spyOn(cosmos.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({ value: [{ name: 'eastus', displayName: 'East US' }] }),
            })),
        );
    }
    world.operationReads = 0;
    world.storageReads = 0;
    try {
        world.collected = await withMetrics(
            (options) => {
                const name = options?.metricnames ?? '';
                if (name === 'TotalRequestUnits' && mode === 'idle') {
                    const member = options?.filter?.includes("'b'");
                    if (!world.pool || (member && world.pool.memberRead === 'failed')) {
                        throw denied();
                    }
                    return metricResponse(name, [member && world.pool.memberRead === 'empty' ? [] : [0]], 'total');
                }
                if (name === 'TotalRequests' && mode === 'operations') {
                    const operations = options?.filter?.includes('OperationType');
                    if (operations) {
                        world.operationReads = (world.operationReads ?? 0) + 1;
                        if (world.operationDenied) {
                            throw denied();
                        }
                    }
                    const counts = Object.entries((operations ? world.operations : world.statuses) ?? {});
                    const response = metricResponse(
                        name,
                        counts.map(([, value]) => [value]),
                        'count',
                    );
                    response.value[0].timeseries?.forEach((series, index) => {
                        series.metadatavalues = [
                            { name: { value: operations ? 'OperationType' : 'StatusCode' }, value: counts[index][0] },
                        ];
                    });
                    return response;
                }
                if (name === 'DataUsageV2' && world.backupStorage) {
                    world.backupStorageTop = options?.top;
                    const storageIds = ids.slice(0, Math.min(world.backupStorage.observed ?? 0, options?.top ?? 10));
                    const response = metricResponse(
                        name,
                        storageIds.map(() => [1_000_000_000]),
                        'total',
                    );
                    response.value[0].unit = 'Bytes';
                    response.value[0].timeseries?.forEach((series, index) => {
                        series.metadatavalues = [
                            ...dims('db', storageIds[index]),
                            { name: { value: 'Region' }, value: 'East US' },
                        ];
                        series.data = [{ timeStamp: new Date(now), total: 1_000_000_000 }];
                    });
                    return response;
                }
                if (name === 'IndexUsage,DataUsage' && world.indexingBatch !== undefined) {
                    assert.ok(options?.timespan && options.interval && options.top && options.top >= ids.length);
                    const start = Date.parse(options.timespan.split('/')[0]);
                    const { windowMs, bucketMs } = DIAGNOSTIC_POLICY.indexing.observation;
                    const response = metricResponse(
                        'DataUsage',
                        ids.map(() => [100]),
                    );
                    response.timespan = options.timespan;
                    response.interval = options.interval;
                    response.value[0].unit = 'Bytes';
                    response.value[0].timeseries?.forEach((series, i) => {
                        series.metadatavalues = dims('db', ids[i]);
                        series.data = Array.from({ length: windowMs / bucketMs }, (_, bucket) => ({
                            timeStamp: new Date(start + bucket * bucketMs),
                            maximum: 100,
                        }));
                    });
                    return response;
                }
                if (name === 'IndexUsage' || name === 'DataUsage') {
                    world.storageReads = (world.storageReads ?? 0) + 1;
                    if (world.storageDenied) {
                        throw denied();
                    }
                    if (mode === 'indexing') {
                        return metricResponse(name, [[name === 'IndexUsage' ? 60 : 100]]);
                    }
                }
                return metricResponse(name, []);
            },
            async (monitor) => {
                const activity = vi.spyOn(monitor.activityLogs, 'list').mockImplementation(() => pagedItems([]));
                try {
                    return await collectDerivedAdvisories({
                        cosmosClient: cosmos,
                        monitorClient: monitor,
                        accountId,
                        resourceGroup: 'rg',
                        accountName: world.account.accountName,
                        accountConfig: world.account,
                        isServerless: serverless,
                        advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
                        costContext: mode === 'backup' ? costContext : undefined,
                    });
                } finally {
                    activity.mockRestore();
                }
            },
        );
    } finally {
        retainedSpies.forEach((spy) => spy.mockRestore());
    }
}

function coverage(world: World, rule: DerivedAdvisoryRule) {
    const entry = world.collected?.detectorCoverage.find((item) => item.rule === rule);
    assert.ok(entry, 'Expected production coverage.');
    return entry;
}

function findings(world: World, rule: DerivedAdvisoryRule) {
    assert.ok(world.collected, 'Expected a collected report.');
    return world.collected.advisories.filter((finding) => finding.rule === rule);
}

async function priceFinding(world: World): Promise<void> {
    const bill = world.idleBill;
    const finding = world.result && 'advisory' in world.result ? world.result.advisory : undefined;
    assert.ok(bill?.meter && bill.cost !== undefined && finding);
    world.advisory = finding;
    const cosmosClient = new CosmosDBManagementClient(noToken, 'sub');
    const send = vi.spyOn(cosmosClient.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
        request,
        status: 200,
        headers: createHttpHeaders(),
        bodyAsText: JSON.stringify({
            properties: {
                columns: [
                    { name: 'Cost', type: 'Number' },
                    { name: 'UsageQuantity', type: 'Number' },
                    { name: 'MeterCategory', type: 'String' },
                    { name: 'Meter', type: 'String' },
                    { name: 'Currency', type: 'String' },
                ],
                rows: [[bill.cost, 1000, 'Azure Cosmos DB', bill.meter, 'USD']],
            },
        }),
    }));
    try {
        await withMetrics(metricResponse('TotalRequestUnits', []), (monitorClient) =>
            enrichAdvisoryCosts({
                advisories: [finding],
                accountId,
                cosmosClient,
                monitorClient,
                now: Date.now(),
                context: {
                    ...costContext,
                    locationNames: Array.from({ length: bill.regions }, (_, i) => `region-${i}`),
                    multiRegionWritesEnabled: bill.multiWrite,
                    writeRegionCount: bill.multiWrite ? bill.regions : 1,
                    zoneRedundantRegionCount: bill.zoneRegions,
                    freeTier: false,
                    isServerless: false,
                },
            }),
        );
    } finally {
        send.mockRestore();
    }
}

export const reportBindings: readonly Binding[] = [
    given(/^the optional utilization read is denied$/, (world) => {
        world.idleUtilizationDenied = true;
    }),
    then(/^utilization is reported as unavailable$/, (world) => {
        observation(world);
        assert.deepEqual(world.idleMetricReads, ['TotalRequestUnits']);
        assert.equal(world.advisory?.evidence?.utilizationPercent, undefined);
    }),
    then(/^the abstention reason is no_data$/, (world) => {
        const result = observation(world);
        assert.ok('abstentionReason' in result);
        assert.equal(result.abstentionReason, 'no_data');
    }),
    then(/^no decommissioning guidance is returned$/, (world) => {
        assert.equal(world.advisory, undefined);
    }),
    when(/^the required dedicated consumption read is denied$/, (world) => collectFixture(world, 'idle')),
    then(/^the report shows a failed check with no recovery or decommissioning guidance$/, (world) => {
        assert.deepEqual(findings(world, 'IdleContainer'), []);
        assert.equal(coverage(world, 'IdleContainer').status, 'unavailable');
        assert.deepEqual(coverage(world, 'IdleContainer').unavailableReasons, ['rbac']);
    }),
    given(/^a year-old account with a shared database and a dedicated sibling$/, (world) => {
        world.pool = {};
    }),
    given(/^the shared database creation age is (\S+) days and the dedicated age is (\S+) days$/, (world, match) => {
        assert.ok(world.pool);
        Object.assign(world.pool, { databaseAge: match[1], containerAge: match[2] });
    }),
    given(/^the creation lookup raises a parsing error$/, (world) => {
        assert.ok(world.pool);
        world.pool.malformedAge = true;
    }),
    given(
        /^shared member B returns (\S+) consumption while A and the dedicated sibling report zero$/,
        (world, match) => {
            assert.ok(world.pool);
            world.pool.memberRead = match[1];
        },
    ),
    when(/^CODA runs the production idle checks$/, (world) => collectFixture(world, 'idle')),
    then(/^the shared pool result is (\S+) with reason (\S+)$/, (world, match) => {
        const finding = findings(world, 'IdleContainer').find((item) => item.scope === 'db');
        assert.equal(finding ? 'finding' : 'abstained', match[1]);
        if (finding) {
            assert.equal(match[2], 'idle');
            assert.equal(recoverableCapacity(finding), 1000);
        } else {
            const state = coverage(world, 'IdleContainer');
            assert.ok(
                state.status === 'partial' || state.status === 'unavailable' || state.status === 'insufficientData',
            );
            const sampleFailure = world.collected?.metricSource.failures.find(
                (item) => item.rule === 'IdleContainer' && item.scope === 'db',
            );
            assert.equal(
                sampleFailure?.reason,
                match[2] === 'incomplete_shared_pool' ? 'rbac' : match[2] === 'too_new' ? undefined : 'noData',
            );
        }
    }),
    then(/^the shared pool records the age lookup error$/, (world) => {
        assert.ok(findings(world, 'IdleContainer').some((item) => item.scope === 'db/dedicated'));
        const failure = world.collected?.metricSource.failures.find(
            (item) => item.rule === 'IdleContainer' && item.scope === 'db',
        );
        assert.equal(failure?.detail, 'invalidResourceCreationTime');
    }),
    then(/^the dedicated result is (\S+)$/, (world, match) => {
        assert.equal(
            findings(world, 'IdleContainer').some((item) => item.scope === 'db/dedicated') ? 'finding' : 'abstained',
            match[1],
        );
    }),
    given(
        /^a paid (single-write|multi-write) account in (\d+) regions with (\d+|unknown) zone-redundant regions$/,
        (world, match) => {
            world.idleBill = {
                multiWrite: match[1] === 'multi-write',
                regions: number(match[2]),
                zoneRegions: match[3] === 'unknown' ? undefined : number(match[3]),
            };
        },
    ),
    given(/^the amortized bill shows (\S+) USD for 1000 units of "([^"]+)"$/, (world, match) => {
        assert.ok(world.idleBill);
        Object.assign(world.idleBill, { cost: number(match[1]), meter: match[2] });
    }),
    when(
        /^CODA prices DX-004 for (manual|autoscale) throughput of (\S+) RU\/s with TotalRequestUnits samples of (\S+)$/,
        async (world, match) => {
            world.result = idleContainerDetector.evaluateResult(
                {
                    databaseId: 'db',
                    containerId: 'c0',
                    resourceAgeDays: 30,
                    throughputMode: match[1] === 'manual' ? 'dedicated' : 'autoscale',
                    provisionedRu: number(match[2]),
                    peakRuPerBucket: number(match[3]),
                },
                DEFAULT_ADVISORY_THRESHOLDS.idlePeakRuPerBucket,
            );
            await priceFinding(world);
        },
    ),
    when(
        /^CODA prices DX-001 for manual throughput of (\S+) RU\/s with NormalizedRUConsumption samples of (\S+)$/,
        async (world, match) => {
            world.result = overProvisioningDetector.evaluateResult(
                {
                    databaseId: 'db',
                    containerId: 'c0',
                    resourceAgeDays: 30,
                    provisionedRu: number(match[1]),
                    ruPercents: Array<number>(DIAGNOSTIC_POLICY.overProvisioning.minSamples).fill(number(match[2])),
                },
                DEFAULT_ADVISORY_THRESHOLDS.overProvisioningBandPercent,
            );
            await priceFinding(world);
        },
    ),
    when(
        /^CODA prices DX-011 for autoscale throughput of (\S+) RU\/s with AutoscaledRU samples of (\S+)$/,
        async (world, match) => {
            const configuredMaxRu = number(match[1]);
            const percent = (100 * number(match[2])) / configuredMaxRu;
            world.result = autoscaleMaxOverProvisionedDetector.evaluateResult(
                {
                    databaseId: 'db',
                    containerId: 'c0',
                    resourceAgeDays: 30,
                    configuredMaxRu,
                    avgPercent: percent,
                    peakPercent: percent,
                    sampleCount: DIAGNOSTIC_POLICY.autoscaleUtilization.minSamples,
                },
                DEFAULT_ADVISORY_THRESHOLDS.overProvisioningBandPercent,
            );
            await priceFinding(world);
        },
    ),
    when(/^CODA prices DX-008 removal of extra regions for (\S+) manual RU\/s per region$/, async (world, match) => {
        const bill = world.idleBill;
        assert.ok(bill);
        world.result = multiRegionWriteAntipatternDetector.evaluateResult(
            {
                ...world.account,
                accountName: 'fixture-dev',
                multiRegionWritesEnabled: bill.multiWrite,
                regionCount: bill.regions,
                writeRegionCount: bill.regions,
                isServerless: false,
            },
            number(match[1]),
        );
        await priceFinding(world);
    }),
    then(/^physical recoverable capacity stays (\S+) RU\/s$/, (world, match) => {
        assert.ok(world.advisory);
        near(recoverableCapacity(world.advisory), match[1]);
    }),
    then(/^the monthly estimate is (\S+) USD for (\S+) billed units per hour$/, (world, match) => {
        const estimate = world.advisory?.costEstimate;
        assert.equal(estimate?.basis, 'customerAmortizedBill');
        assert.equal(estimate.currency, 'USD');
        near(estimate.monthlyAmount, match[1]);
        near(estimate.billedUnitsPerHour, match[2]);
    }),
    then(/^the finding has no currency estimate$/, (world) => {
        assert.equal(world.advisory?.costEstimate, undefined);
    }),
    given(
        /^ARM lists (\d+) containers in one region with a backup price of USD (\S+) per GB-month$/,
        (world, match) => {
            world.backupStorage = { total: number(match[1]), price: number(match[2]) };
        },
    ),
    given(/^(\d+) containers each have 1 GB of storage at the same timestamp$/, (world, match) => {
        assert.ok(world.backupStorage);
        world.backupStorage.observed = number(match[1]);
    }),
    when(/^CODA reports DX-019 with storage pricing$/, async (world) => {
        const storage = world.backupStorage;
        assert.ok(storage);
        const existingFetch = globalThis.fetch;
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            BillingCurrency: 'USD',
                            NextPageLink: null,
                            Items: [
                                {
                                    armRegionName: 'eastus',
                                    serviceName: 'Azure Cosmos DB',
                                    productName: 'Azure Cosmos DB - PITR',
                                    skuName: 'Backup',
                                    meterName: 'Cont 30D Bckp Continuous Backup',
                                    type: 'Consumption',
                                    unitOfMeasure: '1 GB',
                                    tierMinimumUnits: 0,
                                    isPrimaryMeterRegion: true,
                                    currencyCode: 'USD',
                                    retailPrice: storage.price,
                                    meterId: 'fixture',
                                    effectiveStartDate: '2020-01-01T00:00:00Z',
                                },
                            ],
                        }),
                    ),
            ),
        );
        try {
            await collectFixture(world, 'backup');
        } finally {
            vi.stubGlobal('fetch', existingFetch);
        }
    }),
    then(/^the paid backup finding remains Medium$/, (world) => {
        assert.deepEqual(
            findings(world, 'PaidContinuousBackup').map((item) => item.severity),
            ['Medium'],
        );
        assert.equal(coverage(world, 'PaidContinuousBackup').status, 'evaluated');
    }),
    then(/^the monthly storage estimate is (USD \S+|unavailable)$/, (world, match) => {
        assert.ok(world.backupStorage);
        assert.equal(world.backupStorageTop, world.backupStorage.total);
        const estimate = findings(world, 'PaidContinuousBackup')[0]?.costEstimate;
        if (match[1] === 'unavailable') {
            assert.equal(estimate, undefined);
            assert.deepEqual(world.collected?.costSource?.failures, [{ operation: 'backup', kind: 'noData' }]);
        } else {
            assert.equal(estimate?.currency, 'USD');
            near(estimate?.monthlyAmount, match[1].slice(4));
        }
    }),
    given(/^Monitor denies the operation breakdown$/, (world) => {
        world.operationDenied = true;
    }),
    when(/^CODA reports DX-021$/, (world) => collectFixture(world, 'operations')),
    then(/^attribution is incomplete but (\d+) throttled requests are reported$/, async (world, match) => {
        if (!world.collected) {
            await collectFixture(world, 'operations');
        }
        assert.deepEqual(findings(world, 'ThrottlingByOperation'), []);
        assert.equal(coverage(world, 'ThrottlingByOperation').evaluatedCount, 0);
        assert.equal(world.collected?.throttlingObservation?.attributionIncomplete, true);
        assert.ok(world.statuses);
        const totalRequests = Object.values(world.statuses).reduce((sum, count) => sum + count, 0);
        const totalThrottled = number(match[1]);
        assert.equal(world.operationReads, 1);
        assert.deepEqual(world.collected?.throttlingObservation, {
            totalRequests,
            totalThrottled,
            throttleRatePercent: (100 * totalThrottled) / totalRequests,
            attributionIncomplete: true,
        });
    }),
    then(/^the report distinguishes a failed operation read from an empty breakdown$/, (world) => {
        assert.equal(coverage(world, 'ThrottlingByOperation').status, 'unavailable');
        assert.deepEqual(coverage(world, 'ThrottlingByOperation').unavailableReasons, ['rbac']);
    }),
    then(/^the completed check reports the below-threshold throttling without reading operations$/, (world) => {
        assert.equal(world.operationReads, 0);
        assert.deepEqual(findings(world, 'ThrottlingByOperation'), []);
        assert.equal(coverage(world, 'ThrottlingByOperation').status, 'evaluated');
        assert.deepEqual(world.collected?.throttlingObservation, {
            totalThrottled: 50,
            totalRequests: 10000,
            throttleRatePercent: 0.5,
            attributionIncomplete: false,
        });
    }),
    then(/^the breakdown is marked (\S+) with (\d+) attributed responses$/, (world, match) => {
        assert.ok(world.statuses);
        const result = throttlingByOperationDetector.evaluateResult({
            statusCounts: world.statuses,
            throttledOperationCounts: world.operations,
        });
        assert.equal(result.rootCause, 'insufficient_data');
        assert.equal(result.abstentionReason, match[1]);
        assert.equal(result.attributedThrottled, number(match[2]));
    }),
    given(/^a batch of (\d+) containers missing their index size with usable individual reads$/, (world, match) => {
        world.indexingBatch = number(match[1]);
    }),
    when(/^CODA evaluates the indexing batch$/, (world) => collectFixture(world, 'indexing')),
    then(/^(\d+) containers have usable results and (\d+) are explicitly incomplete$/, (world, match) => {
        const advisories = findings(world, 'IndexingCostRisk');
        const result = coverage(world, 'IndexingCostRisk');
        assert.equal(world.storageReads, number(match[1]));
        assert.deepEqual(
            { findings: advisories.length, evaluated: result.evaluatedCount, incomplete: result.insufficientDataCount },
            { findings: number(match[1]), evaluated: number(match[1]), incomplete: number(match[2]) },
        );
    }),
    given(/^a verified container with disabled indexing and a rejected storage projection$/, (world) => {
        world.storageDenied = true;
    }),
    when(/^CODA evaluates that projection$/, (world) => collectFixture(world, 'indexing')),
    then(/^indexing remains disabled with no risk or savings recommendation$/, (world) => {
        assert.equal(world.storageReads, 0);
        assert.deepEqual(findings(world, 'IndexingCostRisk'), []);
        assert.equal(coverage(world, 'IndexingCostRisk').status, 'notApplicable');
        assert.equal(coverage(world, 'IndexingCostRisk').notApplicableCount, 1);
    }),
];
