/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { collectDerivedAdvisories } from '../../../accountOverview/services/advisories';
import type * as advisories from '../../../accountOverview/services/advisories';
import { mockClient } from '../../../accountOverview/services/testFixtures';
import { getDerivedAdvisoriesForAccount } from './derivedAdvisoriesRouter';

vi.mock('../../trpc', () => ({ accountOverviewProcedure: { query: vi.fn() } }));
vi.mock('../../../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));
vi.mock('../../../accountOverview/services/advisories', async (importOriginal) => ({
    ...(await importOriginal<typeof advisories>()),
    collectDerivedAdvisories: vi.fn(),
}));
vi.mock('./thresholds', async () => {
    const { DEFAULT_ADVISORY_THRESHOLDS } =
        await import('../../../accountOverview/services/advisories/core/thresholds');
    const { DEFAULT_HEALTH_THRESHOLDS } = await import('../../../accountOverview/services/inventoryMetrics');
    const { DEFAULT_PARTITION_THRESHOLDS } = await import('../../../accountOverview/services/partitionHealth');
    return {
        readAdvisoryThresholds: () => DEFAULT_ADVISORY_THRESHOLDS,
        readHealthThresholds: () => DEFAULT_HEALTH_THRESHOLDS,
        readPartitionThresholds: () => DEFAULT_PARTITION_THRESHOLDS,
    };
});

type Metadata = Parameters<typeof getDerivedAdvisoriesForAccount>[0];

function metadata(account: DatabaseAccountGetResults = {}) {
    return {
        accountId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
        accountName: 'account',
        resourceGroup: 'rg',
        subscription: { name: 'Production' },
        isServerless: false,
        databaseAccount: {
            kind: 'GlobalDocumentDB',
            locations: [{ locationName: 'westus' }, { locationName: 'eastus' }],
            consistencyPolicy: { defaultConsistencyLevel: 'Strong' },
            ...account,
        },
        getMonitorClient: vi.fn<Metadata['getMonitorClient']>().mockResolvedValue(mockClient({})),
        getClient: vi
            .fn<Metadata['getClient']>()
            .mockResolvedValue(new CosmosDBManagementClient({ getToken: async () => null }, 'sub')),
        getLogsQueryClient: vi.fn<Metadata['getLogsQueryClient']>().mockResolvedValue(undefined),
    } satisfies Metadata;
}

beforeEach(() => vi.clearAllMocks());

describe('account advisory acquisition', () => {
    it.each(['unsupported', 'noData', 'rbac'] as const)(
        'separates metric and log coverage in the %s configuration-only fallback',
        async (reason) => {
            const input = metadata(reason === 'unsupported' ? { capabilities: [{ name: 'EnableGremlin' }] } : {});
            if (reason === 'noData') {
                input.getMonitorClient.mockResolvedValue(undefined);
            } else if (reason === 'rbac') {
                input.getMonitorClient.mockRejectedValue({ statusCode: 403 });
            }

            const result = await getDerivedAdvisoriesForAccount(input);
            expect(result.metricSource?.available).toBe(false);
            expect(result.metricSource?.failures).toHaveLength(13);
            expect(result.metricSource?.failures.every((failure) => failure.reason === reason)).toBe(true);
            const failedRules = result.metricSource?.failures.map((failure) => failure.rule);
            for (const rule of [
                'ExpensiveConsistency',
                'MultiRegionWriteAntipattern',
                'CrossPartitionQuery',
                'ShardKeyMisalignment',
                'UncontrolledIngestion',
                'SharedThroughputStarvation',
            ]) {
                expect(failedRules).not.toContain(rule);
            }
            expect(result.logSource).toEqual({ available: false, reason });
        },
    );

    it.each([
        { capabilities: [{ name: 'EnableGremlin' }] },
        { capabilities: [{ name: 'EnableCassandra' }] },
        { capabilities: [{ name: 'EnableTable' }] },
    ])('runs wrong-API configuration detection without querying SQL inventory: %j', async (account) => {
        const input = metadata({ ...account, enableMultipleWriteLocations: true });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(result.advisories).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'MultiRegionWriteAntipattern', severity: 'High' }),
            ]),
        );
        expect(result.metricSource?.available).toBe(false);
        expect(result.metricSource?.failures.every((failure) => failure.reason === 'unsupported')).toBe(true);
        expect(input.getMonitorClient).not.toHaveBeenCalled();
        expect(input.getClient).not.toHaveBeenCalled();
        expect(input.getLogsQueryClient).not.toHaveBeenCalled();
        expect(collectDerivedAdvisories).not.toHaveBeenCalled();
    });

    it('does not collect SQL inventory for an unknown API', async () => {
        const input = metadata({ kind: 'Unknown', capabilities: [{ name: 'Unknown' }] });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(result.advisories).toEqual([expect.objectContaining({ rule: 'ExpensiveConsistency' })]);
        expect(result.metricSource?.available).toBe(false);
        expect(result.metricSource?.failures.every((failure) => failure.reason === 'unsupported')).toBe(true);
        expect(input.getMonitorClient).not.toHaveBeenCalled();
        expect(input.getClient).not.toHaveBeenCalled();
        expect(input.getLogsQueryClient).not.toHaveBeenCalled();
        expect(collectDerivedAdvisories).not.toHaveBeenCalled();
    });

    it.each([{}, { capabilities: [] }])('passes the canonical NoSQL API to collection: %j', async (account) => {
        vi.mocked(collectDerivedAdvisories).mockResolvedValueOnce({
            advisories: [],
            logSource: { available: false, reason: 'noData' },
            metricSource: { available: true, failures: [] },
        });
        await getDerivedAdvisoriesForAccount(metadata(account));
        expect(collectDerivedAdvisories).toHaveBeenCalledWith(
            expect.objectContaining({ accountConfig: expect.objectContaining({ api: API.Core }) }),
        );
    });

    it('keeps configuration findings and reports denied client acquisition', async () => {
        const input = metadata();
        input.getMonitorClient.mockRejectedValue({ statusCode: 403 });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(result.available).toBe(true);
        expect(result.advisories).toEqual([expect.objectContaining({ rule: 'ExpensiveConsistency' })]);
        expect(result.metricSource?.failures.every((failure) => failure.reason === 'rbac')).toBe(true);
    });

    it('keeps configuration findings when inventory collection fails', async () => {
        vi.mocked(collectDerivedAdvisories).mockRejectedValueOnce({ statusCode: 403 });
        const result = await getDerivedAdvisoriesForAccount(metadata());
        expect(result.advisories).toEqual([expect.objectContaining({ rule: 'ExpensiveConsistency' })]);
        expect(result.metricSource?.available).toBe(false);
    });

    it('preserves collection coverage even when the optional log client throws', async () => {
        const input = metadata();
        input.getLogsQueryClient.mockRejectedValue(new Error('unavailable'));
        const metricSource = {
            available: false,
            failures: [{ rule: 'IdleContainer' as const, scope: 'db/container', reason: 'rbac' as const }],
        };
        vi.mocked(collectDerivedAdvisories).mockResolvedValueOnce({
            advisories: [],
            logSource: { available: false, reason: 'noData' },
            metricSource,
        });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(collectDerivedAdvisories).toHaveBeenCalledWith(expect.objectContaining({ logsClient: undefined }));
        expect(result.metricSource).toEqual(metricSource);
    });
});
