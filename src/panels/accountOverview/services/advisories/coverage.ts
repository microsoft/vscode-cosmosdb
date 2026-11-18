/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DerivedAdvisoryRule,
    type DetectorCoverage,
    type LogsSourceStatus,
    type MetricSourceStatus,
} from './core/types';
import { type LogsOperation } from './fetchers/logsDiagnostics';
import { CONFIGURATION_ONLY_RULES } from './registry';

const REQUIRED_LOG_OPERATIONS: Partial<Record<DerivedAdvisoryRule, readonly LogsOperation[]>> = {
    CrossPartitionQuery: ['client', 'probeQueryRuntime', 'crossPartition'],
    ShardKeyMisalignment: ['client', 'probeQueryRuntime', 'crossPartition'],
    UncontrolledIngestion: ['client', 'ingestionSummary', 'ingestionBurst', 'ingestionUserAgent'],
    SharedThroughputStarvation: ['client', 'sharedThroughput'],
};

interface DetectorAvailability {
    metricSource: MetricSourceStatus;
    logSource: LogsSourceStatus;
    /** Absent when inventory failed; zero is meaningful only when the target set is known. */
    targetCounts?: Partial<Record<DerivedAdvisoryRule, number>>;
    uncertainTargetRules?: readonly DerivedAdvisoryRule[];
}

/** Combines actual evaluations with unavailable dependencies without inferring counts of missing resources. Pure. */
export function completeDetectorCoverage(
    coverage: readonly DetectorCoverage[],
    { metricSource, logSource, targetCounts, uncertainTargetRules }: DetectorAvailability,
): DetectorCoverage[] {
    return coverage.map((entry): DetectorCoverage => {
        const inputCount = entry.evaluatedCount + entry.notApplicableCount + entry.insufficientDataCount;
        const targetCount = targetCounts?.[entry.rule];
        const operations = REQUIRED_LOG_OPERATIONS[entry.rule];
        const needsRequestLogs = entry.rule === 'UncontrolledIngestion' || entry.rule === 'SharedThroughputStarvation';
        const metricReasons = metricSource.failures
            .filter((failure) => failure.rule === entry.rule && !CONFIGURATION_ONLY_RULES.includes(entry.rule))
            .map((failure) => failure.reason);
        const logReasons = operations
            ? (logSource.failures
                  ?.filter(
                      (failure) =>
                          operations.includes(failure.operation) ||
                          (needsRequestLogs && inputCount === 0 && failure.operation === 'probeDataPlane'),
                  )
                  .map((failure) => failure.reason) ??
              (!logSource.available && logSource.reason ? [logSource.reason] : []))
            : [];
        const unavailableReasons = [...new Set([...entry.unavailableReasons, ...metricReasons, ...logReasons])].sort();

        if (inputCount === 0 && targetCount === 0) {
            return { ...entry, status: 'notApplicable', unavailableReasons: [] };
        }
        if (unavailableReasons.length === 0) {
            if (uncertainTargetRules?.includes(entry.rule) || (targetCount !== undefined && targetCount > inputCount)) {
                return {
                    ...entry,
                    status: entry.evaluatedCount > 0 || entry.notApplicableCount > 0 ? 'partial' : 'insufficientData',
                };
            }
            return entry;
        }

        return {
            ...entry,
            status: entry.evaluatedCount > 0 || entry.notApplicableCount > 0 ? 'partial' : 'unavailable',
            unavailableReasons,
        };
    });
}
