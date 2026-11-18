/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createArmTestContext } from '../../cosmosdb/armTestUtils';
import { READ_SOURCES, type ReadFailure } from './accessRequirements';
import {
    COST_FAILURE_KINDS,
    DERIVED_ADVISORY_RULES,
    DETECTOR_COVERAGE_STATUSES,
    type CostFailureKind,
    type DetectorCoverage,
} from './services/advisories/core/types';
import { LOGS_FAILURE_KINDS } from './services/advisories/fetchers/logsDiagnostics';
import { UNAVAILABLE_REASONS } from './services/shared';
import { reportOverviewResultTelemetry } from './telemetry';
import {
    overviewAdvisoryResultSchema,
    overviewErrorSchema,
    overviewEventSchema,
    overviewReadResultSchema,
    type OverviewAdvisoryResult,
    type OverviewReadResult,
} from './telemetryContract';

vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../utils/azureClients', () => ({}));

describe('Account Overview telemetry summaries', () => {
    it('keeps telemetry diagnostic types identical to the shared domain types', () => {
        expectTypeOf<OverviewReadResult['diagnostics']>().toEqualTypeOf<ReadFailure[] | undefined>();
        expectTypeOf<
            NonNullable<OverviewAdvisoryResult['costSource']>['failures'][number]['kind']
        >().toEqualTypeOf<CostFailureKind>();
        expectTypeOf<OverviewAdvisoryResult['detectorCoverage']>().toEqualTypeOf<DetectorCoverage[] | undefined>();
    });

    it.each(DERIVED_ADVISORY_RULES)('reports bounded per-rule coverage for %s on the existing RPC context', (rule) => {
        const context = createArmTestContext();
        const result = {
            available: true,
            advisories: [{ evidence: { query: 'private-query' }, scope: 'private-db/private-container' }],
            detectorCoverage: [
                {
                    rule,
                    status: 'partial',
                    evaluatedCount: 3,
                    matchedCount: 1,
                    notApplicableCount: 2,
                    insufficientDataCount: 4,
                    unavailableReasons: ['rbac', 'noData', 'rbac'],
                    scope: 'private-db/private-container',
                    observations: { privateValue: 123 },
                },
            ],
        };

        reportOverviewResultTelemetry(context, result);

        expect(context.telemetry.properties).toEqual({
            dataResult: 'complete',
            [`detector${rule}Status`]: 'partial',
            [`detector${rule}UnavailableReasons`]: 'noData,rbac',
        });
        expect(context.telemetry.measurements).toEqual({
            readFailureCount: 0,
            advisoryCount: 1,
            [`detector${rule}EvaluatedCount`]: 3,
            [`detector${rule}MatchedCount`]: 1,
            [`detector${rule}NotApplicableCount`]: 2,
            [`detector${rule}InsufficientDataCount`]: 4,
        });
        expect(JSON.stringify(context.telemetry)).not.toMatch(/private|123/);
    });

    it.each(DETECTOR_COVERAGE_STATUSES)('accepts the shared detector coverage status %s', (status) => {
        expect(
            overviewAdvisoryResultSchema.parse({
                advisories: [],
                detectorCoverage: [
                    {
                        rule: 'HotPartitionRisk',
                        status,
                        evaluatedCount: 0,
                        matchedCount: 0,
                        notApplicableCount: 0,
                        insufficientDataCount: 0,
                        unavailableReasons: [],
                    },
                ],
            }).detectorCoverage?.[0].status,
        ).toBe(status);
    });

    it.each([
        { rule: 'private-container' },
        { status: 'private-error' },
        { unavailableReasons: ['private-reason'] },
        { evaluatedCount: -1 },
        { matchedCount: 2 },
        { evaluatedCount: Infinity },
        { insufficientDataCount: NaN },
        { notApplicableCount: 0.5 },
        { matchedCount: 'private-value' },
    ])('rejects unbounded or invalid detector coverage instead of emitting it: %j', (invalid) => {
        const context = createArmTestContext();
        const result = {
            available: true,
            advisories: [],
            detectorCoverage: [
                {
                    rule: 'HotPartitionRisk',
                    status: 'evaluated',
                    evaluatedCount: 1,
                    matchedCount: 0,
                    notApplicableCount: 0,
                    insufficientDataCount: 0,
                    unavailableReasons: [],
                    ...invalid,
                },
            ],
        };

        expect(overviewAdvisoryResultSchema.safeParse(result).success).toBe(false);
        reportOverviewResultTelemetry(context, result);
        expect(context.telemetry.properties).toEqual({ dataResult: 'complete' });
        expect(context.telemetry.measurements).toEqual({ readFailureCount: 0 });
    });

    it.each(READ_SOURCES)('accepts the shared read source %s', (source) => {
        const diagnostics = [{ source, kind: 'unknown', reason: 'noData' }] satisfies ReadFailure[];
        expect(overviewReadResultSchema.parse({ available: true, diagnostics }).diagnostics).toEqual(diagnostics);
    });

    it.each(LOGS_FAILURE_KINDS)('accepts the shared read failure kind %s', (kind) => {
        const diagnostics = [{ source: 'logs', kind, reason: 'noData' }] satisfies ReadFailure[];
        expect(overviewReadResultSchema.parse({ available: true, diagnostics }).diagnostics).toEqual(diagnostics);
    });

    it.each(UNAVAILABLE_REASONS)(
        'accepts the shared unavailable reason %s in both result and event contracts',
        (reason) => {
            const diagnostics = [{ source: 'logs', kind: 'unknown', reason }] satisfies ReadFailure[];
            expect(overviewReadResultSchema.parse({ available: true, diagnostics }).diagnostics).toEqual(diagnostics);
            expect(
                overviewEventSchema.parse({ eventName: 'analyzerSkipped', properties: { reason } }).properties?.reason,
            ).toBe(reason);
        },
    );

    it.each(COST_FAILURE_KINDS)('accepts and reports the shared cost failure kind %s', (kind) => {
        const result = {
            available: true,
            advisories: [],
            costSource: { available: false, failures: [{ kind }] },
        };
        expect(overviewAdvisoryResultSchema.parse(result).costSource).toEqual(result.costSource);
        const context = createArmTestContext();
        reportOverviewResultTelemetry(context, result);
        expect(context.telemetry.properties.costFailureKinds).toBe(kind);
        expect(context.telemetry.measurements.costFailureCount).toBe(1);
    });

    it.each([
        [{ available: true }, 'complete'],
        [{ available: false, reason: 'noData' }, 'unavailable'],
        [{ available: false, reason: 'unsupported' }, 'unavailable'],
    ])('does not turn a successful empty/inapplicable read into an exception: %j', (result, dataResult) => {
        const context = createArmTestContext();
        reportOverviewResultTelemetry(context, result);
        expect(context.telemetry.properties).toEqual({ dataResult });
        expect(context.telemetry.measurements).toEqual({ readFailureCount: 0 });
    });

    it.each([{ available: true }, { available: false }])(
        'records caught failures independently of the fallback: %j',
        (result) => {
            const context = createArmTestContext();
            reportOverviewResultTelemetry(context, {
                ...result,
                diagnostics: [
                    { source: 'metrics', kind: 'accessDenied', reason: 'rbac' },
                    { source: 'logs', kind: 'partialFailure', reason: 'rbac' },
                    { source: 'metrics', kind: 'transient', reason: 'noData' },
                ],
            });
            expect(context.telemetry.properties).toEqual({
                dataResult: result.available ? 'partial' : 'unavailable',
                errorCategory: 'infrastructure',
                readFailureSources: 'logs,metrics',
                readFailureKinds: 'accessDenied,partialFailure,transient',
                readFailureReasons: 'noData,rbac',
            });
            expect(context.telemetry.measurements).toEqual({ readFailureCount: 3 });
        },
    );

    it('reports coverage without copying finding evidence, metric scopes or billing payloads', () => {
        const context = createArmTestContext();
        reportOverviewResultTelemetry(context, {
            available: true,
            generatedAt: 0,
            advisories: [],
            metricSource: {
                available: false,
                failures: [{ rule: 'IdleContainer', scope: 'private-db/private-container', reason: 'rbac' }],
            },
            logSource: { available: false, reason: 'rbac' },
            costSource: { available: false, failures: [{ operation: 'throughput', kind: 'accessDenied' }] },
        });
        expect(context.telemetry.properties).toEqual({
            dataResult: 'complete',
            metricCoverage: 'false',
            logCoverage: 'false',
            costCoverage: 'false',
            costFailureKinds: 'accessDenied',
        });
        expect(context.telemetry.measurements).toEqual({
            readFailureCount: 0,
            advisoryCount: 0,
            skippedMetricCheckCount: 1,
            failedLogCheckCount: 0,
            costFailureCount: 1,
        });
        expect(JSON.stringify(context.telemetry)).not.toContain('private-');
    });

    it.each([
        undefined,
        null,
        true,
        'private-query',
        { accountName: 'private-account' },
        { available: 'private-value' },
        {
            available: true,
            diagnostics: [{ source: 'private-source', kind: 'accessDenied', reason: 'rbac' }],
        },
        {
            available: true,
            diagnostics: [{ source: 'logs', kind: 'private-kind', reason: 'rbac' }],
        },
        {
            available: true,
            diagnostics: [{ source: 'logs', kind: 'accessDenied', reason: 'private-reason' }],
        },
    ])('does not interpret other result shapes or unbounded values as read telemetry: %j', (result) => {
        const context = createArmTestContext();
        reportOverviewResultTelemetry(context, result);
        expect(context.telemetry.properties).toEqual({});
        expect(context.telemetry.measurements).toEqual({});
    });

    it('does not emit arbitrary cost failure kinds', () => {
        const context = createArmTestContext();
        reportOverviewResultTelemetry(context, {
            available: true,
            advisories: [],
            costSource: { available: false, failures: [{ kind: 'private-error-message' }] },
        });
        expect(context.telemetry.properties).toEqual({ dataResult: 'complete' });
        expect(context.telemetry.measurements).toEqual({ readFailureCount: 0 });
    });

    it('accepts only bounded telemetry values and drops arbitrary payload fields', () => {
        expect(
            overviewEventSchema.parse({
                eventName: 'tabViewed',
                properties: { tab: 'monitoring', accountName: 'private-account' },
                measurements: { privateValue: 123 },
            }),
        ).toEqual({ eventName: 'tabViewed', properties: { tab: 'monitoring' } });
        expect(overviewEventSchema.safeParse({ eventName: 'private-account' }).success).toBe(false);
        expect(
            overviewEventSchema.safeParse({
                eventName: 'tabViewed',
                properties: { tab: 'private-database' },
            }).success,
        ).toBe(false);
        expect(
            overviewErrorSchema.parse({
                kind: 'render',
                message: 'private-query',
                stack: 'private-path',
            }),
        ).toEqual({ kind: 'render' });
        expect(overviewErrorSchema.safeParse({ kind: 'subscription', operation: 'private-resource' }).success).toBe(
            false,
        );
        expect(overviewErrorSchema.safeParse({ kind: 'rpc', operation: 'getAlerts' }).success).toBe(false);
    });
});
