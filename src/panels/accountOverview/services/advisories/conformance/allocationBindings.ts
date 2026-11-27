/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../core/thresholds';
import { autoscaleMaxOverProvisionedDetector } from '../detectors/AutoscaleMaxOverProvisionedDetector';
import { multiRegionWriteAntipatternDetector } from '../detectors/MultiRegionWriteAntipatternDetector';
import { collectAllocations } from './allocationFixtures';
import { metricResponse } from './metricsFixture';
import { observation, observed, type Binding, type World } from './shared';

const mixedInventory = new WeakMap<World, { unresolved: boolean }>();
const mixedAutoscale = new WeakSet<World>();

/**
 * Mixed allocations must go through inventory and collection, not a fixture-supplied capacity
 * total or sample-count override.
 */
export async function evaluateAllocationCase(world: World, detector: string): Promise<boolean> {
    const mixed = mixedInventory.get(world);
    if (detector === 'DX-008' && mixed) {
        world.collected = await collectAllocations(
            world.account,
            { resource: { throughput: 4000 } },
            { dedicated: { resource: { throughput: 1000 } }, ...(mixed.unresolved && { unknown: {} }) },
        );
        world.advisory = world.collected.advisories.find((finding) => finding.rule === 'MultiRegionWriteAntipattern');
        assert.ok(world.advisory, 'The configuration finding must survive offer acquisition.');
        const configuredRu = world.advisory.evidence?.configuredPerRegionRu;
        assert.ok(configuredRu === undefined || typeof configuredRu === 'number');
        world.result = multiRegionWriteAntipatternDetector.evaluateResult(world.account, configuredRu);
        assert.deepEqual(world.advisory, world.result.advisory);
        return true;
    }

    if (detector === 'DX-011' && mixedAutoscale.has(world)) {
        const input = world.autoscale;
        assert.ok(input?.shared);
        const pool = { resource: { autoscaleSettings: { maxThroughput: input.max } } };
        const metricFilters: (string | undefined)[] = [];
        world.collected = await collectAllocations(world.account, pool, { dedicated: pool }, (options) => {
            const name = options?.metricnames ?? '';
            if (name !== 'AutoscaledRU') {
                return metricResponse(name, []);
            }
            metricFilters.push(options?.filter);
            return metricResponse(name, [Array<number>(input.samples).fill(input.peaks[0])]);
        });
        assert.deepEqual(metricFilters, [
            "CollectionName eq 'dedicated' and DatabaseName eq 'db' and PhysicalPartitionId eq '*'",
        ]);
        assert.ok(
            world.collected.metricSource.failures.some(
                (failure) =>
                    failure.rule === 'AutoscaleMaxOverProvisioned' &&
                    failure.scope === 'db' &&
                    failure.reason === 'noData',
            ),
        );
        assert.ok(
            !world.collected.advisories.some(
                (finding) => finding.rule === 'AutoscaleMaxOverProvisioned' && finding.scope === 'db',
            ),
        );
        // Classify the lack of usable pool samples via the same evaluator, without attributing the fixture's total.
        world.result = autoscaleMaxOverProvisionedDetector.evaluateResult(
            {
                databaseId: 'db',
                configuredMaxRu: input.max,
                sampleCount: 0,
                peakPercent: 0,
                avgPercent: 0,
                resourceAgeDays: 30,
            },
            DEFAULT_ADVISORY_THRESHOLDS.overProvisioningBandPercent,
        );
        world.advisory = world.result.advisory;
        return true;
    }

    return false;
}

export const allocationBindings: readonly Binding[] = [
    {
        type: 'Context',
        pattern: /^the shared members are batch and api, with a dedicated sibling$/,
        execute(world) {
            assert.ok(world.shared);
            world.shared.sharedContainerIds = ['batch', 'api'];
        },
    },
    {
        type: 'Context',
        pattern:
            /^logs contain (batch, api and a much busier dedicated sibling|batch and the dedicated sibling but no api row)$/,
        execute(world, match) {
            assert.ok(world.shared);
            world.shared.collections = [
                { containerId: 'batch', requests: 1000, throttledRequests: 0, ruConsumed: 9000 },
                ...(match[1].startsWith('batch,')
                    ? [{ containerId: 'api', requests: 1000, throttledRequests: 150, ruConsumed: 1000 }]
                    : []),
                { containerId: 'dedicated', requests: 90_000, throttledRequests: 0, ruConsumed: 900_000 },
            ];
        },
    },
    {
        type: 'Outcome',
        pattern: /^api is identified as missing$/,
        execute(world) {
            const result = observation(world);
            assert.ok('missingMembers' in result);
            assert.deepEqual(result.missingMembers, ['api']);
        },
    },
    {
        type: 'Outcome',
        pattern: /^client write failover is not assessed$/,
        execute(world) {
            assert.equal(observed(world, 'clientWriteFailover'), 'not_assessed');
            assert.equal(world.advisory?.evidence?.clientWriteFailover, 'not_assessed');
        },
    },
    {
        type: 'Outcome',
        pattern: /^the recommendation verifies client failover without disabling multi-region writes$/,
        execute(world) {
            assert.ok(world.advisory);
            assert.match(world.advisory.suggestedAction, /verify client write failover.+controlled test/i);
            assert.doesNotMatch(world.advisory.suggestedAction, /disabl|remov/i);
            assert.equal(world.advisory.agentKitRule, null);
            const removable = world.advisory.evidence?.removableExtraRegionRu;
            assert.ok(removable === undefined || removable === null);
        },
    },
    {
        type: 'Context',
        pattern: /^a manual 4000 RU\/s pool, two inherited members, and a dedicated 1000 RU\/s sibling$/,
        execute(world) {
            mixedInventory.set(world, { unresolved: false });
        },
    },
    {
        type: 'Context',
        pattern: /^another container's allocation could not be resolved$/,
        execute(world) {
            const mixed = mixedInventory.get(world);
            assert.ok(mixed);
            mixed.unresolved = true;
        },
    },
    {
        type: 'Context',
        pattern: /^the shared database also contains a dedicated sibling$/,
        execute(world) {
            mixedAutoscale.add(world);
        },
    },
];
