/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { MonitorClient } from '@azure/arm-monitor';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DerivedAdvisory, type DerivedAdvisoryRule } from './core/types';
import { enrichAdvisoryCosts, recoverableCapacity } from './costEstimates';
import { type CostContext } from './fetchers/costManagement';

const now = Date.parse('2026-11-11T12:00:00Z');
const context: CostContext = {
    subscriptionId: 'sub',
    resourceManagerEndpoint: 'https://management.azure.com',
    locationNames: ['East US'],
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

function setup() {
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
                rows: [[8, 1000, 'Azure Cosmos DB', '100 RU/s', 'EUR']],
            },
        }),
    }));
    return {
        send,
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
    it('queries billing once and enriches only eligible active capacity findings without changing decisions or copy', async () => {
        const { send, enrich } = setup();
        const findings = [
            advisory('OverProvisioning', { evidence: { recoverableRu: 400 } }),
            advisory('IdleContainer', { scope: 'db/idle', evidence: { recoverableRu: 1000 } }),
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
        const findings = [advisory('IdleContainer', { evidence: { recoverableRu: 1000 } })];
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
            advisory('IdleContainer', { evidence: { recoverableRu: 1000 } }),
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
            advisory('IdleContainer', { evidence: { recoverableRu: 1000 } }),
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
