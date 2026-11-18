/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ReadFailure } from './services/readDiagnostics';
import {
    overviewAdvisoryResultSchema,
    overviewReadResultSchema,
    type OverviewAdvisoryResult,
} from './telemetryContract';

/** Enriches the existing RPC event; no file contents, paths, or names are emitted. */
export function reportOverviewResultTelemetry(
    context: IActionContext,
    result: unknown,
    failures?: readonly ReadFailure[],
): void {
    // Other queries (such as account summary), mutations and subscriptions do not return read diagnostics.
    const read = overviewReadResultSchema.safeParse(result);
    if (!read.success) {
        return;
    }
    const diagnostics = [...(read.data.diagnostics ?? []), ...(failures ?? [])].filter(
        (failure, index, entries) =>
            entries.findIndex(
                (entry) =>
                    entry.source === failure.source && entry.kind === failure.kind && entry.reason === failure.reason,
            ) === index,
    );

    const advisory = overviewAdvisoryResultSchema.safeParse(result);

    reportOverviewReadTelemetry(
        context,
        diagnostics,
        read.data.available,
        advisory.success &&
            (advisory.data.metricSource?.available === false || advisory.data.logSource?.available === false),
    );
    if (advisory.success) {
        reportOverviewAdvisoryTelemetry(context, advisory.data);
    }
}

/** Enriches the existing RPC event; no file contents, paths, or names are emitted. */
function reportOverviewReadTelemetry(
    context: IActionContext,
    failures: readonly ReadFailure[],
    available: boolean,
    partial: boolean,
): void {
    const { properties, measurements } = context.telemetry;
    properties.dataResult = !available ? 'unavailable' : failures.length || partial ? 'partial' : 'complete';
    measurements.readFailureCount = failures.length;
    if (failures.length) {
        properties.errorCategory = 'infrastructure';
        properties.readFailureSources = [...new Set(failures.map((failure) => failure.source))].sort().join(',');
        properties.readFailureKinds = [...new Set(failures.map((failure) => failure.kind))].sort().join(',');
        properties.readFailureReasons = [...new Set(failures.map((failure) => failure.reason))].sort().join(',');
    }
}

/** Reports collection coverage, not findings/evidence; no file contents, paths, or names are emitted. */
function reportOverviewAdvisoryTelemetry(context: IActionContext, result: OverviewAdvisoryResult): void {
    const { properties, measurements } = context.telemetry;

    measurements.advisoryCount = result.advisories.length;
    for (const coverage of result.detectorCoverage ?? []) {
        const prefix = `detector${coverage.rule}`;

        properties[`${prefix}Status`] = coverage.status;
        measurements[`${prefix}EvaluatedCount`] = coverage.evaluatedCount;
        measurements[`${prefix}MatchedCount`] = coverage.matchedCount;
        if (coverage.notApplicableCount > 0) {
            measurements[`${prefix}NotApplicableCount`] = coverage.notApplicableCount;
        }
        if (coverage.insufficientDataCount > 0) {
            measurements[`${prefix}InsufficientDataCount`] = coverage.insufficientDataCount;
        }
        if (coverage.unavailableReasons.length > 0) {
            properties[`${prefix}UnavailableReasons`] = [...new Set(coverage.unavailableReasons)].sort().join(',');
        }
    }

    if (result.metricSource) {
        properties.metricCoverage = String(result.metricSource.available);
        measurements.skippedMetricCheckCount = result.metricSource.failures.length;
    }
    if (result.logSource) {
        properties.logCoverage = String(result.logSource.available);
        measurements.failedLogCheckCount = result.logSource.failures?.length ?? 0;
    }
}
