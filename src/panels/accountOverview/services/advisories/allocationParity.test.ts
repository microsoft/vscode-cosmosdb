/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { collectAllocations } from './conformance/allocationFixtures';
import { metricResponse } from './conformance/metricsFixture';
import { multiRegionWriteAntipatternDetector } from './detectors/MultiRegionWriteAntipatternDetector';
import { sharedThroughputStarvationDetector } from './detectors/SharedThroughputStarvationDetector';

const account = {
    accountName: 'fixture-prod',
    api: API.Core,
    regionCount: 2,
    writeRegionCount: 2,
    multiRegionWritesEnabled: true,
    isServerless: false,
};

describe('allocation evidence parity', () => {
    it('does not classify a partial shared-member log snapshot as a single active member', () => {
        const result = sharedThroughputStarvationDetector.evaluateResult(
            {
                databaseId: 'mixed',
                sharedRu: 4000,
                sharedContainerIds: ['worker', 'gateway'],
                collections: [
                    { containerId: 'worker', requests: 2000, throttledRequests: 60, ruConsumed: 6000 },
                    { containerId: 'separate', requests: 50_000, throttledRequests: 500, ruConsumed: 200_000 },
                ],
            },
            { minRequests: 100, poolThrottlePct: 5, dominancePct: 60, victimThrottlePct: 5, victimSharePct: 20 },
        );
        expect(result).toEqual({ rootCause: 'insufficient_data', missingMembers: ['gateway'] });
    });

    it('keeps API-specific client guidance separate from regional capacity and remediation', () => {
        const result = multiRegionWriteAntipatternDetector.evaluateResult({ ...account, api: API.Cassandra }, 4000);
        expect(result).toMatchObject({
            rootCause: 'cassandra_multi_region_writes',
            observations: {
                clientWriteFailover: 'not_assessed',
                globalRegionalFootprintRu: 8000,
                removableExtraRegionRu: null,
            },
            advisory: { severity: 'Low', agentKitRule: null },
        });
        expect(result.advisory?.suggestedAction).toMatch(/load-balancing policy/);
        expect(result.advisory?.suggestedAction).not.toMatch(/disabl|remov/i);
    });

    it('does not size a mixed autoscale pool from database totals and still evaluates its dedicated sibling', async () => {
        const autoscale = { resource: { autoscaleSettings: { maxThroughput: 4000 } } };
        const filters: (string | undefined)[] = [];
        const report = await collectAllocations(account, autoscale, { separate: autoscale }, (options) => {
            const name = options?.metricnames ?? '';
            if (name !== 'AutoscaledRU') {
                return metricResponse(name, []);
            }
            filters.push(options?.filter);
            return metricResponse(name, [Array<number>(30).fill(400)]);
        });

        expect(report.advisories.filter((finding) => finding.rule === 'AutoscaleMaxOverProvisioned')).toMatchObject([
            { scope: 'db/separate' },
        ]);
        expect(filters).toEqual([
            "CollectionName eq 'separate' and DatabaseName eq 'db' and PhysicalPartitionId eq '*'",
        ]);
        expect(report.metricSource.failures).toContainEqual({
            rule: 'AutoscaleMaxOverProvisioned',
            scope: 'db',
            reason: 'noData',
        });
    });
});
