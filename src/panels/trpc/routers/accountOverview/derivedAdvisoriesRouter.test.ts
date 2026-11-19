/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API } from '../../../../AzureDBExperiences';
import { collectDerivedAdvisories } from '../../../accountOverview/services/advisories';
import type * as advisories from '../../../accountOverview/services/advisories';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../../../accountOverview/services/advisories/core/thresholds';
import * as inventory from '../../../accountOverview/services/inventory';
import { withReadDiagnostics } from '../../../accountOverview/services/readDiagnostics';
import { mockClient } from '../../../accountOverview/services/testFixtures';
import { getDerivedAdvisoriesForAccount } from './derivedAdvisoriesRouter';

vi.mock('../../trpc', () => ({ accountOverviewProcedure: { query: vi.fn() } }));
vi.mock('../../../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));
vi.mock('../../../accountOverview/services/advisories', async (importOriginal) => ({
    ...(await importOriginal<typeof advisories>()),
    collectDerivedAdvisories: vi.fn(),
}));

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
    it('preserves denied log-client acquisition through real detector coverage without generic duplicates', async () => {
        const input = metadata();
        const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
        input.getClient.mockResolvedValue(cosmosClient);
        const accountRead = vi.spyOn(cosmosClient.databaseAccounts, 'get').mockResolvedValue({});
        const inventoryRead = vi.spyOn(inventory, 'getSqlInventoryDetails').mockResolvedValue({
            rows: [
                {
                    databaseId: 'private-db',
                    containerId: 'private-container',
                    throughputMode: 'dedicated',
                    throughputRU: 1000,
                    offerLevel: 'container',
                    offerThroughputMode: 'manual',
                    resourceCreatedAt: '2020-01-01T00:00:00Z',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                },
            ],
            offers: [],
            databases: [],
        });
        input.getLogsQueryClient.mockRejectedValue({ statusCode: 403 });
        vi.mocked(collectDerivedAdvisories).mockImplementationOnce(async (params) => {
            const actual = await vi.importActual<typeof advisories>('../../../accountOverview/services/advisories');
            return actual.collectDerivedAdvisories(params);
        });

        try {
            const captured = await withReadDiagnostics(() => getDerivedAdvisoriesForAccount(input));

            expect(captured.result.available).toBe(true);
            expect(captured.result.logSource).toEqual({
                available: false,
                reason: 'rbac',
                failures: [{ operation: 'client', kind: 'accessDenied', reason: 'rbac' }],
            });
            for (const rule of ['CrossPartitionQuery', 'ShardKeyMisalignment', 'UncontrolledIngestion']) {
                expect(captured.result.detectorCoverage?.find((entry) => entry.rule === rule)).toMatchObject({
                    status: 'unavailable',
                    unavailableReasons: ['rbac'],
                });
            }
            expect(captured.diagnostics.filter(({ source }) => source === 'logs')).toEqual([
                { source: 'logs', kind: 'accessDenied', reason: 'rbac' },
            ]);
        } finally {
            inventoryRead.mockRestore();
            accountRead.mockRestore();
        }
    });

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
            detectorCoverage: [],
            logSource: { available: false, reason: 'noData' },
            metricSource: { available: true, failures: [] },
        });
        await getDerivedAdvisoriesForAccount(metadata(account));
        expect(collectDerivedAdvisories).toHaveBeenCalledWith(
            expect.objectContaining({
                accountConfig: expect.objectContaining({ api: API.Core }),
                advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
            }),
        );
        const params = vi.mocked(collectDerivedAdvisories).mock.calls[0][0];
        expect(params).not.toHaveProperty('healthThresholds');
        expect(params).not.toHaveProperty('partitionThresholds');
        expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
    });

    it('keeps configuration findings and reports denied client acquisition', async () => {
        const input = metadata();
        input.getMonitorClient.mockRejectedValue({ statusCode: 403 });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(result.available).toBe(true);
        expect(result.advisories).toEqual([expect.objectContaining({ rule: 'ExpensiveConsistency' })]);
        expect(result.metricSource?.failures.every((failure) => failure.reason === 'rbac')).toBe(true);
        expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
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
            detectorCoverage: [],
            logSource: { available: false, reason: 'noData' },
            metricSource,
        });
        const result = await getDerivedAdvisoriesForAccount(input);
        expect(collectDerivedAdvisories).toHaveBeenCalledWith(expect.objectContaining({ logsClient: undefined }));
        expect(result.metricSource).toEqual(metricSource);
    });
});
