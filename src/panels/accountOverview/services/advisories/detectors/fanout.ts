/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type CrossPartitionInput, type DerivedAdvisorySeverity, type QueryShapeInput } from '../core/types';

export function fanoutStats(input: CrossPartitionInput, fanoutThreshold: number) {
    if (
        !Number.isFinite(input.evaluationWindowSeconds) ||
        input.evaluationWindowSeconds <= 0 ||
        input.shapes.some(
            (shape) =>
                !Number.isFinite(shape.executions) ||
                shape.executions < 0 ||
                !Number.isFinite(shape.avgFanout) ||
                shape.avgFanout < 0 ||
                !Number.isFinite(shape.maxFanout) ||
                shape.maxFanout < 0,
        )
    ) {
        return undefined;
    }
    const totalQueries = input.shapes.reduce((sum, shape) => sum + shape.executions, 0);
    const containerPartitions = input.shapes.reduce((max, shape) => Math.max(max, shape.maxFanout), 0);
    const crossShapes = input.shapes.filter((shape) => shape.avgFanout >= fanoutThreshold);
    const crossQueries = crossShapes.reduce((sum, shape) => sum + shape.executions, 0);
    const worst = crossShapes.reduce<QueryShapeInput | undefined>(
        (best, shape) => (!best || shape.executions > best.executions ? shape : best),
        undefined,
    );
    return {
        totalQueries,
        containerPartitions,
        crossPartitionPct: totalQueries > 0 ? (100 * crossQueries) / totalQueries : 0,
        crossQueriesPerSecond: crossQueries / input.evaluationWindowSeconds,
        worst,
    };
}

export function fanoutSeverity(partitions: number, queriesPerSecond: number): DerivedAdvisorySeverity {
    const policy = DIAGNOSTIC_POLICY.crossPartition;
    if (partitions >= policy.highPartitions) {
        return queriesPerSecond >= policy.highQueriesPerSecond ? 'High' : 'Medium';
    }

    return partitions >= policy.mediumPartitions && queriesPerSecond >= policy.highQueriesPerSecond ? 'Medium' : 'Low';
}

export function fanoutRuEvidence(
    input: CrossPartitionInput,
    shape: QueryShapeInput | undefined,
): Record<string, number | string> {
    return shape?.avgRu !== undefined && Number.isFinite(shape.avgRu) && shape.avgRu >= 0
        ? {
              queryRuStatus: 'observed',
              worstShapeAvgRu: shape.avgRu,
              worstShapeRuExecutions: shape.executions,
              queryRuSource: 'CDBDataPlaneRequests',
              ...(input.observationStart && input.observationEnd
                  ? { observationStart: input.observationStart, observationEnd: input.observationEnd }
                  : {}),
          }
        : { queryRuStatus: 'unavailable' };
}

export function fanoutRuDescription(shape: QueryShapeInput | undefined): string {
    return shape?.avgRu !== undefined && Number.isFinite(shape.avgRu) && shape.avgRu >= 0
        ? ' ' +
              l10n.t(
                  'The most frequent fan-out shape averaged `{ru} RU` per logical execution with complete request-log matches. Observed charge is supporting evidence, not estimated savings.',
                  { ru: shape.avgRu.toFixed(2) },
              )
        : '';
}
