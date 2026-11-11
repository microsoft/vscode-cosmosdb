/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { API } from '../../../../AzureDBExperiences';
import { configurationFailures } from './core/helpers';
import { DEFAULT_ADVISORY_THRESHOLDS } from './core/thresholds';
import { type AccountConfigInput } from './core/types';
import { nonThrottlingErrorsDetector } from './detectors/NonThrottlingErrorsDetector';
import { paidContinuousBackupDetector } from './detectors/PaidContinuousBackupDetector';
import { perRegionAutoscaleCandidateDetector } from './detectors/PerRegionAutoscaleCandidateDetector';
import { reservedCapacityCandidateDetector } from './detectors/ReservedCapacityCandidateDetector';
import { throttlingByOperationDetector } from './detectors/ThrottlingByOperationDetector';
import { computeDerivedAdvisories } from './engine';
import { DETECTORS } from './registry';

const config: AccountConfigInput = {
    accountName: 'account-dev',
    regionCount: 2,
    multiRegionWritesEnabled: false,
    writeRegionCount: 1,
    api: API.Core,
    isServerless: false,
    perRegionPerPartitionAutoscaleEnabled: false,
    backupPolicy: { type: 'Continuous', continuousTier: 'Continuous30Days' },
};

describe('native DX-019 paid continuous retention', () => {
    it.each<{
        overrides: Partial<AccountConfigInput>;
        rootCause: string;
        missing: boolean;
    }>([
        { overrides: { backupPolicy: undefined }, rootCause: 'unknown', missing: true },
        { overrides: { backupPolicy: { type: 'Unknown' } }, rootCause: 'unknown', missing: true },
        { overrides: { backupPolicy: { type: 'pErIoDiC' } }, rootCause: 'periodic_backup', missing: false },
        {
            overrides: { backupPolicy: { type: 'Continuous', continuousTier: ' Continuous7Days ' } },
            rootCause: 'uncharged_7day_backup',
            missing: false,
        },
        {
            overrides: { backupPolicy: { type: 'Continuous', continuousTier: 'Unknown' } },
            rootCause: 'unknown_continuous_tier',
            missing: true,
        },
        {
            overrides: { accountName: 'account-prod', backupPolicy: { type: 'Continuous' } },
            rootCause: 'unknown_continuous_tier',
            missing: false,
        },
        {
            overrides: { accountName: 'account', backupPolicy: { type: 'Continuous' } },
            rootCause: 'unknown_continuous_tier',
            missing: false,
        },
        { overrides: { accountName: 'account-prod' }, rootCause: 'legitimate_prod_backup', missing: false },
        { overrides: { accountName: 'account' }, rootCause: 'legitimate_prod_backup', missing: false },
        { overrides: {}, rootCause: 'nonprod_paid_continuous_backup', missing: false },
    ])('preserves classification and coverage for $overrides', ({ overrides, rootCause, missing }) => {
        const input = { ...config, ...overrides };
        expect(paidContinuousBackupDetector.evaluateResult(input).rootCause).toBe(rootCause);
        expect(configurationFailures(input).some((failure) => failure.rule === 'PaidContinuousBackup')).toBe(missing);
    });

    it.each<[string | undefined, string | undefined]>([
        ['Continuous30Days', 'Medium'],
        ['cOnTiNuOuS35DaYs', 'Medium'],
        ['Continuous7Days', undefined],
        ['Unknown', undefined],
        [undefined, undefined],
    ])('evaluates tier %s without inventing a paid tier', (continuousTier, severity) => {
        const result = paidContinuousBackupDetector.evaluate({
            ...config,
            backupPolicy: { type: 'Continuous', continuousTier },
        });
        expect(result?.severity).toBe(severity);
    });

    it.each([
        { accountName: 'account-prod' },
        { accountName: 'account' },
        { accountName: 'account-dev', tags: { environment: 'production' } },
        { backupPolicy: { type: 'Periodic', continuousTier: 'Continuous30Days' } },
        { backupPolicy: undefined },
    ])('does not infer non-production paid retention: %j', (overrides) => {
        expect(paidContinuousBackupDetector.evaluate({ ...config, ...overrides })).toBeUndefined();
    });

    it('keeps retention review separate from a savings estimate or disabling PITR', () => {
        const result = paidContinuousBackupDetector.evaluate(config);
        expect(result).toMatchObject({
            severity: 'Medium',
            agentKitRule: null,
            actionEligibility: 'requiresValidation',
            evidence: { continuousTier: 'continuous30days', inferredEnvironment: 'dev' },
        });
        expect(result?.suggestedAction).toContain('Older restore points would be lost');
        expect(result?.suggestedAction).toContain('Do not revert to periodic');
        expect(result?.evidence).not.toHaveProperty('savings');
    });
});

describe('native DX-020 non-429 errors', () => {
    it.each<[number, string | undefined]>([
        [9, undefined],
        [10, 'Low'],
        [49, 'Low'],
        [50, 'Medium'],
        [99, 'Medium'],
        [100, 'High'],
    ])('grades %s hard errors in 1,000 requests without rounding before gates', (errors, severity) => {
        const result = nonThrottlingErrorsDetector.evaluate({ statusCounts: { 200: 1000 - errors, 500: errors } });
        expect(result?.severity).toBe(severity);
    });

    it('includes 429s in the denominator but not the hard-error numerator', () => {
        const result = nonThrottlingErrorsDetector.evaluate({ statusCounts: { 200: 590, 429: 400, 404: 10 } });
        expect(result?.evidence).toMatchObject({
            totalRequests: 1000,
            totalErrors: 10,
            errorRatePercent: 1,
            status404RatePercent: 1,
        });
        expect(nonThrottlingErrorsDetector.evaluate({ statusCounts: { 200: 600, 429: 400 } })).toBeUndefined();
    });

    it.each<Record<string, number>>([
        { 200: 899, 500: 100 },
        { 200: 100_000, 500: 1009 },
        { broken: 100_000, 500: 10 },
        { 200: NaN, 500: 10 },
        { 200: Infinity, 500: -1 },
        {},
    ])('abstains for insufficient/invalid observations: %j', (statusCounts) => {
        expect(nonThrottlingErrorsDetector.evaluate({ statusCounts })).toBeUndefined();
    });

    it.each<[number, string | null, string]>([
        [404, 'sdk-conditional-create-etag', 'Only if code or traces confirm'],
        [409, 'sdk-conditional-create-etag', 'Upsert can overwrite'],
        [412, 'sdk-etag-concurrency', 'expected concurrency protection'],
        [401, null, 'Increasing throughput is not a general remedy'],
        [403, null, 'do not identify a missing role'],
        [500, null, '5xx can be service-side'],
    ])('uses only conditional guidance for dominant %s', (status, agentKitRule, action) => {
        const result = nonThrottlingErrorsDetector.evaluate({ statusCounts: { 200: 900, [status]: 100 } });
        expect(result).toMatchObject({ agentKitRule, evidence: { dominantStatus: status } });
        expect(result?.suggestedAction).toContain(action);
        expect(result?.rationale).toContain('do not identify an application, container, operation or item');
    });

    it('does not select a minority mapped error over a dominant service failure', () => {
        expect(
            nonThrottlingErrorsDetector.evaluate({
                statusCounts: { 200: 800, 500: 150, 404: 30, 409: 10, 412: 10, invalid: 50, 201: -10 },
            }),
        ).toMatchObject({
            severity: 'High',
            agentKitRule: null,
            evidence: { totalRequests: 1000, dominantStatus: 500 },
        });
    });
});

describe('native DX-021 throttled operation investigation', () => {
    it.each<[number, string | undefined]>([
        [99, undefined],
        [100, 'Low'],
        [499, 'Low'],
        [500, 'Medium'],
        [1999, 'Medium'],
        [2000, 'High'],
    ])('grades %s throttles in 10,000 requests', (throttles, severity) => {
        const result = throttlingByOperationDetector.evaluate({
            statusCounts: { 200: 10_000 - throttles, 429: throttles },
            throttledOperationCounts: { Create: throttles },
        });
        expect(result?.severity).toBe(severity);
    });

    it.each([
        ['Create', 'write', 'sdk-ingestion-rate-control'],
        ['ExecuteBatch', 'write', 'sdk-ingestion-rate-control'],
        [' head ', 'read', 'partition-avoid-hotspots'],
        ['Read', 'read', 'partition-avoid-hotspots'],
        ['ReadFeed', 'query', 'query-avoid-cross-partition'],
        ['QueryPlan', 'query', 'query-avoid-cross-partition'],
        ['ExecuteStoredProcedure', 'execute', 'monitoring-ru-consumption'],
        ['ExecuteJavaScript', 'execute', 'monitoring-ru-consumption'],
        ['NewOperation', 'other', 'monitoring-throttling'],
        ['constructor', 'other', 'monitoring-throttling'],
    ])('classifies %s without claiming root cause', (operation, category, agentKitRule) => {
        const result = throttlingByOperationDetector.evaluate({
            statusCounts: { 200: 900, 429: 100 },
            throttledOperationCounts: { [operation]: 100 },
        });
        expect(result).toMatchObject({
            agentKitRule,
            evidence: { dominantCategory: category, dominantSharePercent: 100 },
        });
        expect(result?.rationale).toContain('does not prove a root cause');
    });

    it('selects the dominant individual operation, not the combined category', () => {
        const result = throttlingByOperationDetector.evaluate({
            statusCounts: { 200: 8700, 429: 1300 },
            throttledOperationCounts: { Create: 400, Upsert: 400, Read: 500, invalid: NaN, zero: 0 },
        });
        expect(result).toMatchObject({
            agentKitRule: 'partition-avoid-hotspots',
            evidence: { dominantOperation: 'Read', dominantCategory: 'read' },
        });
        expect(result?.evidence?.writeSharePercent).toBeCloseTo((800 / 1300) * 100);
        expect(result?.evidence?.readSharePercent).toBeCloseTo((500 / 1300) * 100);
    });

    it.each<{ counts: Record<string, number> | undefined }>([
        { counts: undefined },
        { counts: {} },
        { counts: { Create: 0 } },
        { counts: { Create: NaN } },
        { counts: { ' ': 100 } },
    ])('does not invent an operation breakdown: %j', ({ counts: throttledOperationCounts }) => {
        expect(
            throttlingByOperationDetector.evaluate({
                statusCounts: { 200: 800, 429: 200 },
                throttledOperationCounts,
            }),
        ).toBeUndefined();
    });

    it('preserves independent-source share semantics rather than normalizing missing operations to 100%', () => {
        const result = throttlingByOperationDetector.evaluate({
            statusCounts: { 200: 900, 429: 100 },
            throttledOperationCounts: { Query: 50 },
        });
        expect(result?.evidence).toMatchObject({ querySharePercent: 50, dominantSharePercent: 50 });
    });

    it('requires 1,000 requests and escapes literal operation markup', () => {
        expect(
            throttlingByOperationDetector.evaluate({
                statusCounts: { 200: 899, 429: 100 },
                throttledOperationCounts: { Create: 100 },
            }),
        ).toBeUndefined();
        const result = throttlingByOperationDetector.evaluate({
            statusCounts: { 200: 900, 429: 100 },
            throttledOperationCounts: { 'op`name': 100 },
        });
        expect(result?.rationale).toContain('op\\`name');
    });
});

describe('native DX-022 and DX-023 configuration reviews', () => {
    it.each([
        { regions: 0, serverless: true, enabled: undefined, rootCause: 'serverless', missing: false },
        { regions: 1, serverless: false, enabled: undefined, rootCause: 'single_region', missing: false },
        { regions: 1, serverless: undefined, enabled: undefined, rootCause: 'unknown', missing: false },
        { regions: 2, serverless: undefined, enabled: false, rootCause: 'unknown', missing: true },
        { regions: 2, serverless: false, enabled: undefined, rootCause: 'unknown', missing: true },
        { regions: 2, serverless: false, enabled: true, rootCause: 'already_enabled', missing: false },
        { regions: 2, serverless: false, enabled: false, rootCause: 'prpa_candidate', missing: false },
        { regions: 0, serverless: false, enabled: true, rootCause: 'unknown', missing: true },
        { regions: 1.5, serverless: false, enabled: false, rootCause: 'unknown', missing: true },
        { regions: NaN, serverless: false, enabled: false, rootCause: 'unknown', missing: true },
    ])(
        'preserves regional classification and coverage for %j',
        ({ regions, serverless, enabled, rootCause, missing }) => {
            const input = {
                ...config,
                regionCount: regions,
                isServerless: serverless,
                perRegionPerPartitionAutoscaleEnabled: enabled,
            };
            expect(perRegionAutoscaleCandidateDetector.evaluateResult(input).rootCause).toBe(rootCause);
            expect(configurationFailures(input).some((failure) => failure.rule === 'PerRegionAutoscaleCandidate')).toBe(
                missing,
            );
        },
    );

    it('reports both configuration checks as missing when account metadata is unavailable', () => {
        expect(configurationFailures(undefined)).toEqual([
            { rule: 'PaidContinuousBackup', reason: 'noData' },
            { rule: 'PerRegionAutoscaleCandidate', reason: 'noData' },
        ]);
    });

    it.each<[number, boolean | undefined, boolean | undefined, string | undefined]>([
        [1, false, false, undefined],
        [2, false, false, 'Low'],
        [3, false, false, 'Low'],
        [2, true, false, undefined],
        [2, false, true, undefined],
        [2, false, undefined, undefined],
        [0, false, false, undefined],
        [NaN, false, false, undefined],
        [1.5, false, false, undefined],
        [2, undefined, false, undefined],
    ])('evaluates regions=%s, serverless=%s, feature=%s', (regionCount, isServerless, enabled, severity) => {
        expect(
            perRegionAutoscaleCandidateDetector.evaluate({
                ...config,
                regionCount,
                isServerless,
                perRegionPerPartitionAutoscaleEnabled: enabled,
            })?.severity,
        ).toBe(severity);
    });

    it.each<[number | undefined, string | undefined]>([
        [undefined, undefined],
        [NaN, undefined],
        [Infinity, undefined],
        [-1, undefined],
        [2999, undefined],
        [3000, 'Low'],
        [250_000, 'Low'],
    ])('keeps baseline %s unknown/below-threshold or constant Low', (baseline, severity) => {
        expect(reservedCapacityCandidateDetector.evaluate(baseline, false)?.severity).toBe(severity);
        expect(reservedCapacityCandidateDetector.evaluate(baseline, true)).toBeUndefined();
        expect(reservedCapacityCandidateDetector.evaluate(baseline, undefined)).toBeUndefined();
    });

    it('reports missing configuration without treating missing feature state as off', () => {
        expect(
            configurationFailures({
                ...config,
                backupPolicy: { type: 'Continuous' },
                perRegionPerPartitionAutoscaleEnabled: undefined,
            }),
        ).toEqual([
            { rule: 'PaidContinuousBackup', reason: 'noData' },
            { rule: 'PerRegionAutoscaleCandidate', reason: 'noData' },
        ]);
        expect(configurationFailures(config)).toEqual([]);
        expect(
            configurationFailures({
                ...config,
                accountName: 'account-prod',
                backupPolicy: { type: 'Continuous' },
            }),
        ).toEqual([]);
    });

    it('registers all five new rules and evaluates independent native inputs together', () => {
        expect(DETECTORS).toHaveLength(24);
        expect(new Set(DETECTORS.map((detector) => detector.rule)).size).toBe(24);
        const results = computeDerivedAdvisories(
            {
                weeklyRuPercents: [],
                hasManualThroughput: false,
                partitions: [],
                storage: [],
                indexing: [],
                accountConfig: config,
                scopeProvisionedRuTotal: 5000,
                accountRequests: {
                    statusCounts: { 200: 800, 404: 100, 429: 100 },
                    throttledOperationCounts: { Create: 70 },
                },
            },
            DEFAULT_ADVISORY_THRESHOLDS,
        );
        expect(results.map((result) => result.rule).sort()).toEqual([
            'NonThrottlingErrors',
            'PaidContinuousBackup',
            'PerRegionAutoscaleCandidate',
            'ReservedCapacityCandidate',
            'ThrottlingByOperation',
        ]);
        expect(results.every((result) => result.scope === undefined && result.rationale.length <= 500)).toBe(true);
    });
});
