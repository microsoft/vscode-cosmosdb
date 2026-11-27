/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MetricsListOptionalParams } from '@azure/arm-monitor';
import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { getThrottleRate } from '../../ruTrends';
import { pagedItems } from '../../testFixtures';
import { DAY } from '../../units';
import { collectDerivedAdvisories } from '../collect';
import { DEFAULT_ADVISORY_THRESHOLDS, DIAGNOSTIC_POLICY } from '../core/thresholds';
import { hotPartitionRiskDetector } from '../detectors/HotPartitionRiskDetector';
import { GIB } from '../detectors/storageMath';
import { storageSkewRiskDetector } from '../detectors/StorageSkewRiskDetector';
import { underProvisioningDetector } from '../detectors/UnderProvisioningDetector';
import { getRegionalPartitionEvidence, type PartitionCoverageEvidence } from '../fetchers/partitionEvidence';
import { metricResponse, withMetrics } from './metricsFixture';
import { number, type Binding, type World } from './shared';

interface PartitionFixture {
    regions: Map<string, { expected?: number; values?: number[] }>;
    afterGap?: number[];
    coverage?: PartitionCoverageEvidence;
}

const fixtures = new WeakMap<World, PartitionFixture>();
const scope = { databaseId: 'fixture-db', containerId: 'fixture-container' };
const now = Date.UTC(2026, 0, 8);

function fixture(world: World): PartitionFixture {
    let value = fixtures.get(world);
    if (!value) {
        value = { regions: new Map() };
        fixtures.set(world, value);
    }
    return value;
}

function binding(type: Binding['type'], pattern: RegExp, execute: Binding['execute']): Binding {
    return { type, pattern, execute };
}

const given = (pattern: RegExp, execute: Binding['execute']): Binding => binding('Context', pattern, execute);
const then = (pattern: RegExp, execute: Binding['execute']): Binding => binding('Outcome', pattern, execute);

/** Reuse the common context and outcome bindings; only regional and report evidence is local. */
export async function evaluatePartition(world: World, detector: string, report = false): Promise<void> {
    assert.ok(['DX-005', 'DX-006', 'DX-015'].includes(detector));
    const data = fixture(world);
    const storage = detector === 'DX-015';
    const metric = storage ? 'PhysicalPartitionSizeInfo' : 'NormalizedRUConsumption';
    const range = storage
        ? DIAGNOSTIC_POLICY.storageSkew.observation
        : DIAGNOSTIC_POLICY.partitionSaturation.observation;
    const primary = storage
        ? (world.storage?.partitions ?? []).map((partition) => (partition.samples[0]?.bytes ?? 0) / GIB)
        : (world.partitionPeaks ?? []);
    if (data.regions.size === 0) {
        data.regions.set('West', { expected: primary.length || undefined });
    }
    const regions = [...data.regions.keys()];
    const buckets = range.windowMs / range.bucketMs;
    const scale = storage ? GIB : 1;
    function sdkResponse(options?: MetricsListOptionalParams) {
        assert.ok(options?.metricnames);
        const name = options.metricnames;
        if (name === 'TotalRequests') {
            assert.ok(world.requests);
            assert.equal(options.aggregation, 'Count');
            const response = metricResponse(
                name,
                [[world.requests.total - world.requests.throttled], [world.requests.throttled]],
                'count',
            );
            response.value[0].timeseries?.forEach((row, i) => {
                row.metadatavalues = [{ name: { value: 'StatusCode' }, value: i === 0 ? '200' : '429' }];
            });
            return response;
        }
        const region = options.filter?.match(/Region eq '([^']+)'/)?.[1];
        if (report && (!region || (name !== 'PhysicalPartitionCount' && name !== metric))) {
            return metricResponse(name, []);
        }
        assert.equal(options.aggregation, 'Maximum');
        assert.ok(region && data.regions.has(region));
        const start = Date.parse(options.timespan?.split('/')[0] ?? '');
        assert.ok(Number.isFinite(start));
        const configured = data.regions.get(region)!;
        const values = configured.values ?? (region === regions[0] ? primary : []);
        const count = name === 'PhysicalPartitionCount';
        assert.ok(count || name === metric);
        const targetedId = options.filter?.match(/PhysicalPartitionId eq '(\d+)'/)?.[1];
        const series = count
            ? configured.expected === undefined
                ? []
                : [Array<number>(buckets).fill(configured.expected)]
            : values.map((value, index) =>
                  data.afterGap && region === regions[0]
                      ? [value * scale, undefined, data.afterGap[index] * scale]
                      : Array<number>(buckets).fill(value * scale),
              );
        const response = metricResponse(name, series);
        const rows = response.value[0].timeseries ?? [];
        for (const [index, row] of rows.entries()) {
            row.metadatavalues = [
                { name: { value: 'Region' }, value: region },
                ...(!count ? [{ name: { value: 'PhysicalPartitionId' }, value: `${index}` }] : []),
            ];
            row.data?.forEach((point, i) => {
                point.timeStamp = new Date(start + i * range.bucketMs);
            });
        }
        if (targetedId !== undefined) {
            response.value[0].timeseries = rows.filter((_, index) => `${index}` === targetedId);
        }
        return response;
    }

    if (report) {
        const cosmosClient = new CosmosDBManagementClient(
            {
                getToken: async () => {
                    throw new Error('Network access is forbidden in CODA conformance.');
                },
            },
            'fixture',
        );
        const systemData = { createdAt: new Date(Date.now() - 30 * DAY) };
        const spies = [
            vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({
                systemData,
                locations: regions.map((locationName) => ({ locationName })),
            }),
            vi
                .spyOn(cosmosClient.sqlResources, 'listSqlDatabases')
                .mockImplementation(() => pagedItems([{ resource: { id: scope.databaseId } }])),
            vi
                .spyOn(cosmosClient.sqlResources, 'listSqlContainers')
                .mockImplementation(() =>
                    pagedItems([
                        { resource: { id: scope.containerId, indexingPolicy: { indexingMode: 'none' } }, systemData },
                    ]),
                ),
            vi.spyOn(cosmosClient.sqlResources, 'getSqlDatabaseThroughput').mockRejectedValue({ statusCode: 404 }),
            vi
                .spyOn(cosmosClient.sqlResources, 'getSqlContainerThroughput')
                .mockResolvedValue({ resource: { throughput: 4000 } }),
        ];
        try {
            world.collected = await withMetrics(sdkResponse, (monitorClient) =>
                collectDerivedAdvisories({
                    monitorClient,
                    cosmosClient,
                    accountId: '/fixture',
                    resourceGroup: 'fixture-group',
                    accountName: 'fixture',
                    isServerless: false,
                    advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
                    accountConfig: world.account,
                }),
            );
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
        return;
    }

    const observationData = await withMetrics(sdkResponse, async (client) => {
        const regionalEvidence = await getRegionalPartitionEvidence(
            client,
            '/fixture',
            metric,
            range,
            scope,
            regions,
            now,
        );
        const throttle = storage
            ? undefined
            : await getThrottleRate(client, '/fixture', range.timeRange, scope.databaseId, scope.containerId, range);
        return { regionalEvidence, throttle };
    });
    const { regionalEvidence, throttle } = observationData;
    const { storageSkewBalanceRatio, partitionSaturationPercent, partitionHeadroomPercent, throttleRatePercent } =
        DEFAULT_ADVISORY_THRESHOLDS;
    const resourceAgeDays = world.age ?? 30;
    if (storage) {
        const input = { ...scope, partitions: [], resourceAgeDays, regionalEvidence };
        world.inputs.storageSkew = [input];
        const result = storageSkewRiskDetector.evaluateResult(input, storageSkewBalanceRatio);
        world.result = result;
        data.coverage = result.partitionEvidence;
    } else {
        assert.ok(world.requests && throttle);
        const input = {
            ...scope,
            resourceAgeDays,
            regionalEvidence,
            maxP99: 0,
            minP99: 0,
            partitionCount: 0,
            totalRequests: throttle.totalRequests,
            throttledRequests: throttle.throttledRequests,
            throttleRatePercent: throttle.ratePercent,
            throughputMode: world.requests.mode,
            provisionedRu: 4000,
        };
        world.inputs.partitions = [input];
        if (detector === 'DX-005') {
            const result = underProvisioningDetector.evaluateResult(
                input,
                partitionSaturationPercent,
                partitionHeadroomPercent,
                throttleRatePercent,
            );
            data.coverage = result.partitionEvidence;
            world.result = result;
        } else {
            const result = hotPartitionRiskDetector.evaluateResult(
                input,
                partitionSaturationPercent,
                partitionHeadroomPercent,
                throttleRatePercent,
            );
            data.coverage = result.partitionEvidence;
            world.result = result;
        }
    }
    world.advisory = world.result.advisory;
}

export const partitionBindings: readonly Binding[] = [
    given(/^configured region (\S+) has Monitor partition count (\d+|unknown)$/, (world, match) => {
        const { regions } = fixture(world);
        regions.set(match[1], {
            ...regions.get(match[1]),
            expected: match[2] === 'unknown' ? undefined : number(match[2]),
        });
    }),
    given(/^region (\S+) also reports partition values (.+)$/, (world, match) => {
        const region = fixture(world).regions.get(match[1]);
        assert.ok(region, 'A metric response cannot introduce unconfigured regions.');
        region.values = match[2].split(',').map(number);
    }),
    given(
        /^the same two partitions report (\S+) and (\S+) GiB, skip an hour, then report (\S+) and (\S+) GiB$/,
        (world, match) => {
            const data = fixture(world);
            const firstRegion = data.regions.values().next().value;
            assert.ok(firstRegion);
            firstRegion.values = [number(match[1]), number(match[2])];
            data.afterGap = [number(match[3]), number(match[4])];
        },
    ),
    binding('Action', /^CODA reports DX-005$/, async (world, _match, detector) => {
        assert.equal(detector, 'DX-005');
        await evaluatePartition(world, detector, true);
    }),
    then(/^coverage is reported as partial$/, (world) => {
        assert.equal(fixture(world).coverage?.coverageComplete, false);
    }),
    then(/^the skew witness region is (\S+)$/, (world, match) => {
        const coverage = fixture(world).coverage;
        assert.equal(coverage?.witnessRegion, match[1]);
        assert.ok(coverage?.comparableBuckets);
    }),
    then(/^the guidance explains that the logical partition key is not identified$/, (world) => {
        const guidance = world.advisory?.suggestedAction;
        assert.ok(guidance);
        assert.ok(guidance.includes('cannot identify a logical partition key'));
        assert.ok(guidance.includes('or tell which partition returned a 429'));
    }),
    then(/^the report shows (\d+) throttled requests without a capacity finding$/, (world, match) => {
        assert.ok(world.collected);
        assert.equal(world.collected.capacityThrottling?.[0]?.throttledRequests, number(match[1]));
        assert.equal(
            world.collected.advisories.some(({ rule }) => rule === 'SustainedThrottlingInRegion'),
            false,
        );
    }),
    then(/^the explanation contains "([^"]+)"$/, (world, match) => {
        assert.ok(world.collected?.capacityThrottling?.[0]?.explanation?.includes(match[1]));
    }),
];
