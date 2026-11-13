/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { MonitorClient } from '@azure/arm-monitor';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type InventoryContainerRow } from '../inventory';
import { type DerivedAdvisory, type DerivedAdvisoryRule } from './core/types';
import { enrichAdvisoryCosts, recoverableCapacity } from './costEstimates';
import { type CostContext } from './fetchers/costManagement';

const now = Date.parse('2026-11-11T12:00:00Z');
const context: CostContext = {
    subscriptionId: 'sub',
    resourceManagerEndpoint: 'https://management.azure.com',
    locationNames: ['East US'],
    multiRegionWritesEnabled: false,
};

function advisory(rule: DerivedAdvisoryRule, overrides: Partial<DerivedAdvisory> = {}): DerivedAdvisory {
    return {
        id: rule,
        rule,
        severity: 'Low',
        title: rule,
        rationale: 'Original rationale',
        suggestedAction: 'Original action',
        thresholdReference: 'Original threshold',
        ...overrides,
    };
}

function setup(currency = 'EUR', cost = 8, usage = 1000) {
    const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
    const monitorClient = new MonitorClient({ getToken: async () => null }, 'sub');
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
                rows: [[cost, usage, 'Azure Cosmos DB', '100 RU/s', currency]],
            },
        }),
    }));
    return {
        send,
        cosmosClient,
        monitorClient,
        enrich: (advisories: DerivedAdvisory[], costContext: CostContext | undefined = context) =>
            enrichAdvisoryCosts({
                advisories,
                cosmosClient,
                monitorClient,
                context: costContext,
                accountId:
                    '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
                now,
            }),
    };
}

afterEach(() => vi.restoreAllMocks());

describe('optional financial enrichment', () => {
    it('aborts pending storage siblings when one request fails before the deadline', async () => {
        vi.useFakeTimers();
        const caller = new AbortController();
        try {
            const { cosmosClient, monitorClient, send } = setup();
            send.mockImplementation(async (_http, request) => ({
                request,
                status: 200,
                headers: createHttpHeaders(),
                bodyAsText: JSON.stringify({ value: [{ name: 'eastus', displayName: 'East US' }] }),
            }));
            const cancelled = vi.fn();
            const list = vi.spyOn(monitorClient.metrics, 'list').mockImplementation(async (_id, options) => {
                const signal = options?.abortSignal;
                if (!signal) {
                    throw new Error('Expected the shared enrichment cancellation signal.');
                }
                if (options?.filter?.includes("DatabaseName eq 'first'")) {
                    throw Object.assign(new Error('Storage access denied.'), { statusCode: 403 });
                }
                return new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            cancelled();
                            reject(Object.assign(new Error('Storage request aborted.'), { name: 'AbortError' }));
                        },
                        { once: true },
                    );
                });
            });
            const finding = advisory('PaidContinuousBackup');
            const result = await enrichAdvisoryCosts({
                advisories: [finding],
                cosmosClient,
                monitorClient,
                context: { ...context, abortSignal: caller.signal },
                accountId:
                    '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
                inventoryRows: ['first', 'second'].map<InventoryContainerRow>((databaseId) => ({
                    databaseId,
                    containerId: 'items',
                    throughputMode: 'dedicated',
                    partitionKeyPaths: [],
                    indexingMode: 'consistent',
                    excludedPathCount: 0,
                    userExcludedPathCount: 0,
                    compositeIndexCount: 0,
                    health: 'Healthy',
                })),
                now,
            });
            expect(result).toEqual({ available: false, failures: [{ operation: 'backup', kind: 'accessDenied' }] });
            expect(list).toHaveBeenCalledTimes(2);
            expect(list.mock.calls.every(([, options]) => options?.abortSignal?.aborted)).toBe(true);
            expect(cancelled).toHaveBeenCalledOnce();
            expect(caller.signal.aborted).toBe(false);
            expect(finding.costEstimate).toBeUndefined();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            caller.abort();
            vi.useRealTimers();
        }
    });

    it.each([
        { cost: 50, usage: 1, recoverableRu: 0.125, monthlyAmount: 45.62 },
        { cost: 50, usage: 1, recoverableRu: 0.375, monthlyAmount: 136.88 },
        { cost: 9.8377, usage: 4137.5, recoverableRu: 600, monthlyAmount: 10.41 },
    ])('matches actual CODA Python monetary vectors: %j', async ({ cost, usage, recoverableRu, monthlyAmount }) => {
        const { enrich } = setup('USD', cost, usage);
        const finding = advisory('IdleContainer', { evidence: { recoverableRu } });

        expect(await enrich([finding])).toEqual({ available: true, failures: [] });
        expect(finding.costEstimate?.monthlyAmount).toBe(monthlyAmount);
    });

    it('omits positive throughput savings that round to zero, matching CODA', async () => {
        const { enrich } = setup('USD', 50, 1);
        const finding = advisory('IdleContainer', { evidence: { recoverableRu: 0.000001 } });

        expect(await enrich([finding])).toEqual({ available: true, failures: [] });
        expect(finding.costEstimate).toBeUndefined();
    });

    it.each([
        ['IdleContainer', true],
        ['IdleContainer', false],
        ['AutoscaleMaxOverProvisioned', true],
        ['AutoscaleMaxOverProvisioned', false],
    ] as const)('matches CODA bill-derived savings for %s with multi-write=%s', async (rule, writes) => {
        const { enrich } = setup('USD');
        const finding = advisory(rule, {
            evidence: { recoverableRu: 1000, recoverableIdleFloorRu: 1000, throughputMode: 'autoscale' },
        });
        expect(
            await enrich([finding], {
                ...context,
                locationNames: ['East US', 'West US'],
                multiRegionWritesEnabled: writes,
            }),
        ).toEqual({
            available: true,
            failures: [],
        });
        expect(finding.costEstimate).toMatchObject({
            monthlyAmount: expect.closeTo(58.4, 8),
            recoverableRu: 1000,
        });
        expect(finding.costEstimate).not.toHaveProperty('billingConversion');
        expect(finding.costEstimate).not.toHaveProperty('regionalFootprint');
    });

    it.each(['IdleContainer', 'AutoscaleMaxOverProvisioned'] as const)(
        'prices %s without an extra write-configuration gate, matching CODA',
        async (rule) => {
            const { enrich, send } = setup();
            const finding = advisory(rule, {
                evidence: { recoverableRu: 1000, recoverableIdleFloorRu: 1000, throughputMode: 'autoscale' },
            });
            expect(await enrich([finding], { ...context, multiRegionWritesEnabled: undefined })).toEqual({
                available: true,
                failures: [],
            });
            expect(finding.costEstimate?.monthlyAmount).toBe(58.4);
            expect(send).toHaveBeenCalledOnce();
        },
    );

    it.each([undefined, 'unknown', 'serverless'])(
        'does not reinterpret quantified idle capacity using mode %s',
        async (mode) => {
            const { enrich, send } = setup();
            const finding = advisory('IdleContainer', {
                evidence: { recoverableRu: 1000, ...(mode === undefined ? {} : { throughputMode: mode }) },
            });
            expect(await enrich([finding])).toEqual({
                available: true,
                failures: [],
            });
            expect(finding.costEstimate?.monthlyAmount).toBe(58.4);
            expect(send).toHaveBeenCalledOnce();
        },
    );

    it('reports monetary overflow without losing another finding at the same rate', async () => {
        const { enrich, send } = setup('USD', 1000, 1);
        const finding = advisory('IdleContainer', {
            evidence: { recoverableRu: Number.MAX_VALUE, throughputMode: 'autoscale' },
        });
        const finite = advisory('OverProvisioning', { evidence: { recoverableRu: 1 } });

        expect(await enrich([finding, finite])).toEqual({
            available: false,
            failures: [{ operation: 'throughput', kind: 'invalidData' }],
        });
        expect(finding.costEstimate).toBeUndefined();
        expect(finite.costEstimate?.monthlyAmount).toBe(7300);
        expect(send).toHaveBeenCalledOnce();
    });

    it('keeps single-write autoscale idle savings equal to CODA without a premium multiplier', async () => {
        const { enrich } = setup('USD');
        const finding = advisory('IdleContainer', {
            evidence: { provisionedRu: 10000, recoverableRu: 1000, throughputMode: 'autoscale' },
        });
        await enrich([finding], { ...context, multiRegionWritesEnabled: false });
        expect(finding.costEstimate?.monthlyAmount).toBe(58.4);
        expect(finding.costEstimate).toMatchObject({
            currency: 'USD',
            recoverableRu: 1000,
        });
    });

    it.each([
        { regions: ['East US'] },
        { regions: ['East US', 'West US'] },
        { regions: ['East US', 'West US', 'North Europe'] },
    ])(
        'matches CODA without multiplying offer-level capacity by configured regions ($regions)',
        async ({ regions }) => {
            const { enrich, send } = setup();
            const findings = [
                advisory('OverProvisioning', { evidence: { recoverableRu: 1000 } }),
                advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } }),
                advisory('AutoscaleMaxOverProvisioned', { evidence: { recoverableIdleFloorRu: 1000 } }),
                advisory('MultiRegionWriteAntipattern', {
                    evidence: { regionalCapacityQuantified: true, removableExtraRegionRu: 2000 },
                }),
            ];
            expect(await enrich(findings, { ...context, locationNames: regions })).toEqual({
                available: true,
                failures: [],
            });
            for (const finding of findings.slice(0, 3)) {
                expect(finding.costEstimate).toMatchObject({
                    monthlyAmount: 58.4,
                    recoverableRu: 1000,
                });
            }
            expect(findings[3].costEstimate).toMatchObject({
                monthlyAmount: expect.closeTo(116.8, 8),
                recoverableRu: 2000,
            });
            expect(send).toHaveBeenCalledOnce();
        },
    );

    it.each([
        { regions: [] },
        { regions: [''] },
        { regions: ['   '] },
        { regions: ['East US', 'EAST US'] },
        { regions: ['East US', 'eastus'] },
    ])('does not require a separate regional footprint for CODA savings ($regions)', async ({ regions }) => {
        const { enrich, send } = setup();
        const finding = advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } });
        expect(await enrich([finding], { ...context, locationNames: regions })).toEqual({
            available: true,
            failures: [],
        });
        expect(finding.costEstimate?.monthlyAmount).toBe(58.4);
        expect(send).toHaveBeenCalledOnce();
    });

    it('prices detector capacity unchanged when regional metadata is unavailable', async () => {
        const { enrich, send } = setup();
        const findings = [
            advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } }),
            advisory('MultiRegionWriteAntipattern', {
                evidence: { regionalCapacityQuantified: true, removableExtraRegionRu: 2000 },
            }),
        ];
        expect(await enrich(findings, { ...context, locationNames: [] })).toEqual({
            available: true,
            failures: [],
        });
        expect(findings[0].costEstimate?.monthlyAmount).toBe(58.4);
        expect(findings[1].costEstimate).toMatchObject({
            monthlyAmount: expect.closeTo(116.8, 8),
        });
        expect(send).toHaveBeenCalledOnce();
    });

    it('does not introduce regional-capacity overflow absent from CODA', async () => {
        const { enrich, send } = setup();
        const finding = advisory('IdleContainer', {
            evidence: { recoverableRu: Number.MAX_VALUE, throughputMode: 'manual' },
        });
        expect(await enrich([finding], { ...context, locationNames: ['East US', 'West US'] })).toEqual({
            available: true,
            failures: [],
        });
        expect(Number.isFinite(finding.costEstimate?.monthlyAmount)).toBe(true);
        expect(finding.costEstimate).toMatchObject({ recoverableRu: Number.MAX_VALUE });
        expect(send).toHaveBeenCalledOnce();
    });

    it('queries billing once and enriches only eligible active capacity findings without changing decisions or copy', async () => {
        const { send, enrich } = setup();
        const findings = [
            advisory('OverProvisioning', { evidence: { recoverableRu: 400 } }),
            advisory('IdleContainer', {
                scope: 'db/idle',
                evidence: { recoverableRu: 1000, throughputMode: 'manual' },
            }),
            advisory('AutoscaleMaxOverProvisioned', { evidence: { recoverableIdleFloorRu: 400 } }),
            advisory('MultiRegionWriteAntipattern', {
                evidence: { regionalCapacityQuantified: true, removableExtraRegionRu: 2000 },
            }),
            advisory('OverProvisioning', { supersededBy: 'IdleContainer', evidence: { recoverableRu: 1000 } }),
            advisory('OverProvisioning', { actionEligibility: 'blocked', evidence: { recoverableRu: 1000 } }),
            advisory('ExpensiveConsistency', { evidence: { upperBoundAvoidableReadRu: 1000 } }),
            advisory('ReservedCapacityCandidate', { evidence: { recoverableRu: 1000 } }),
        ];
        const before = structuredClone(findings);
        expect(await enrich(findings)).toEqual({ available: true, failures: [] });
        expect(send).toHaveBeenCalledOnce();
        expect(
            findings.map(({ costEstimate, ...original }) => {
                void costEstimate;
                return original;
            }),
        ).toEqual(before);
        expect(findings.slice(0, 4).map((finding) => finding.costEstimate?.monthlyAmount)).toEqual([
            expect.closeTo(23.36, 8),
            expect.closeTo(58.4, 8),
            expect.closeTo(23.36, 8),
            expect.closeTo(116.8, 8),
        ]);
        expect(findings.slice(4).every((finding) => finding.costEstimate === undefined)).toBe(true);
        expect(findings[0].costEstimate).toMatchObject({
            basis: 'customerAmortizedBill',
            currency: 'EUR',
            recoverableRu: 400,
            rate: { source: 'customerAmortizedBill', scope: 'account', cost: 8, usage100RuHours: 1000 },
        });
    });

    it.each([
        advisory('OverProvisioning', { evidence: { recoverableRu: 0 } }),
        advisory('IdleContainer', { evidence: { recoverableRu: -1 } }),
        advisory('IdleContainer', { evidence: { recoverableRu: Infinity } }),
        advisory('IdleContainer', { evidence: { recoverableRu: NaN } }),
        advisory('IdleContainer', { evidence: { recoverableRu: '400' } }),
        advisory('AutoscaleMaxOverProvisioned', { evidence: { recoverableRu: 1000 } }),
        advisory('MultiRegionWriteAntipattern', { evidence: { removableExtraRegionRu: 1000 } }),
        advisory('CrossPartitionQuery', { evidence: { avgRu: 1000 } }),
        advisory('ServerlessCandidate'),
    ])('does not request billing for $rule without eligible quantified capacity', async (finding) => {
        const { send, enrich } = setup();
        expect(recoverableCapacity(finding)).toBeUndefined();
        expect(await enrich([finding])).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it.each([
        [401, 'authentication'],
        [403, 'accessDenied'],
        [429, 'rateLimited'],
        [500, 'serviceError'],
    ] as const)('preserves findings and reports HTTP %s independently of detector coverage', async (status, kind) => {
        const { send, enrich } = setup();
        send.mockImplementation(async (_http, request) => ({
            request,
            status,
            headers: createHttpHeaders(),
            bodyAsText: 'private billing error',
        }));
        const findings = [advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } })];
        const before = structuredClone(findings);
        expect(await enrich(findings)).toEqual({
            available: false,
            failures: [{ operation: 'throughput', kind }],
        });
        expect(findings).toEqual(before);
        expect(send).toHaveBeenCalledOnce();
    });

    it('preserves both findings when billing and independent backup evidence are unavailable', async () => {
        const { enrich } = setup();
        const findings = [
            advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } }),
            advisory('PaidContinuousBackup'),
        ];
        expect(await enrich(findings)).toEqual({
            available: false,
            failures: [{ operation: 'backup', kind: 'noData' }],
        });
        expect(findings[0].costEstimate?.monthlyAmount).toBeCloseTo(58.4, 8);
        expect(findings[1].costEstimate).toBeUndefined();
    });

    it('reports absent billing context without calling Azure or claiming zero savings', async () => {
        const { send } = setup();
        const cosmosClient = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
        const findings = [
            advisory('IdleContainer', { evidence: { recoverableRu: 1000, throughputMode: 'manual' } }),
            advisory('PaidContinuousBackup'),
        ];
        expect(
            await enrichAdvisoryCosts({
                advisories: findings,
                cosmosClient,
                monitorClient: new MonitorClient({ getToken: async () => null }, 'sub'),
                accountId: 'account',
                now,
            }),
        ).toEqual({
            available: false,
            failures: [
                { operation: 'throughput', kind: 'notConfigured' },
                { operation: 'backup', kind: 'notConfigured' },
            ],
        });
        expect(send).not.toHaveBeenCalled();
        expect(findings.every((finding) => finding.costEstimate === undefined)).toBe(true);
    });
});
