/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext, type DetectorEvaluation } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import {
    type CrossPartitionInput,
    type CrossPartitionThresholds,
    type DerivedAdvisorySeverity,
    type QueryShapeInput,
} from '../core/types';

/** Folds the per-shape fan-out into total executions, cross-partition share, and the worst (most frequent) shape. Pure. */
interface CrossPartitionStats {
    totalQueries: number;
    containerPartitions: number;
    crossPartitionPct: number;
    worst: QueryShapeInput | undefined;
}

function crossPartitionStats(shapes: readonly QueryShapeInput[], fanoutThreshold: number): CrossPartitionStats {
    const totalQueries = shapes.reduce((sum, s) => sum + s.executions, 0);
    const containerPartitions = shapes.reduce((max, s) => Math.max(max, s.maxFanout), 0);
    const crossShapes = shapes.filter((s) => s.avgFanout >= fanoutThreshold);
    const crossExec = crossShapes.reduce((sum, s) => sum + s.executions, 0);
    const crossPartitionPct = totalQueries > 0 ? (100 * crossExec) / totalQueries : 0;
    const worst = crossShapes.reduce<QueryShapeInput | undefined>(
        (best, s) => (best === undefined || s.executions > best.executions ? s : best),
        undefined,
    );
    return { totalQueries, containerPartitions, crossPartitionPct, worst };
}

/** Collapses whitespace and truncates an anonymized query shape for display. Pure. */
function shortQueryShape(text: string): string {
    const collapsed = text.split(/\s+/).filter(Boolean).join(' ');
    return collapsed.length > 200 ? collapsed.slice(0, 200) + '…' : collapsed;
}

/**
 * CrossPartitionQuery (CODA DX-002): query shapes that do not filter on the container's partition key fan out
 * across every physical partition, multiplying RU and latency. Fires when the container has ≥ 2 physical
 * partitions, there is enough query traffic (`minQueries`), and the share of executions whose shape fans out
 * (average ≥ `fanoutThreshold` partitions) is at or above `medPct` — High at/above `highPct`, else Medium. The
 * surfaced text is the service-anonymized shape, so remediation is structural (add the partition key to the
 * filter). Container-scoped. Pure.
 */
function evaluateCrossPartitionQuery(
    input: CrossPartitionInput,
    thresholds: CrossPartitionThresholds,
): DetectorEvaluation {
    const { totalQueries, containerPartitions, crossPartitionPct, worst } = crossPartitionStats(
        input.shapes,
        thresholds.fanoutThreshold,
    );
    if (totalQueries < thresholds.minQueries) {
        return { rootCause: 'insufficient_data' };
    }
    if (containerPartitions <= 1) {
        return { rootCause: containerPartitions > 0 ? 'evaluated' : 'insufficient_data' };
    }
    if (crossPartitionPct < thresholds.medPct || worst === undefined) {
        return { rootCause: 'evaluated' };
    }
    const severity: DerivedAdvisorySeverity = crossPartitionPct >= thresholds.highPct ? 'High' : 'Medium';
    const pct = Math.round(crossPartitionPct);
    const shape = shortQueryShape(worst.text);
    return {
        id: `CrossPartitionQuery/${containerKey(input.databaseId, input.containerId)}`,
        rule: 'CrossPartitionQuery',
        severity,
        scope: containerKey(input.databaseId, input.containerId),
        title: l10n.t('Cross-partition query fan-out in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                '`{pct}%` of query executions fan out across partitions (the container has `~{partitions} physical partitions`).',
                { pct, partitions: containerPartitions },
            ) +
                ' ' +
                l10n.t('The most frequent offender averages `{fanout} partitions` per run. Anonymized shape: {shape}', {
                    fanout: worst.avgFanout.toFixed(1),
                    shape: escapeAdvisoryText(shape),
                }),
        ),
        suggestedAction:
            l10n.t(
                "Add the container's partition key to the query filter (or a composite index) so it targets a single logical partition.",
            ) +
            ' ' +
            l10n.t(
                'For access patterns that inherently filter on a different key, serve them from a global secondary index or a change-feed-synced copy.',
            ) +
            ' ' +
            l10n.t('Cross-partition fan-out multiplies RU and latency and does not scale as the container grows.'),
        thresholdReference: l10n.t('Threshold: ≥ `{pct}%` of executions fan out (avg ≥ `{fanout} partitions/query`)', {
            pct: thresholds.medPct,
            fanout: thresholds.fanoutThreshold,
        }),
    };
}

export class CrossPartitionQueryDetector extends Detector {
    readonly rule = 'CrossPartitionQuery' as const;
    protected readonly notApplicableRootCauses = ['not_applicable'];
    evaluate = (...args: Parameters<typeof evaluateCrossPartitionQuery>) =>
        this.getAdvisory(evaluateCrossPartitionQuery(...args));
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        const t = ctx.thresholds;

        return (ctx.inputs.crossPartition ?? []).map((input) =>
            evaluateCrossPartitionQuery(input, {
                minQueries: t.crossPartitionMinQueries,
                fanoutThreshold: t.crossPartitionFanoutThreshold,
                highPct: t.crossPartitionHighPct,
                medPct: t.crossPartitionMedPct,
            }),
        );
    }
}

export const crossPartitionQueryDetector = new CrossPartitionQueryDetector();
