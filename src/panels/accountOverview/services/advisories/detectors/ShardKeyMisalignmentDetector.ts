/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type CrossPartitionInput,
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
    type QueryShapeInput,
    type ShardKeyThresholds,
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

/**
 * ShardKeyMisalignment (CODA DX-007): the structural escalation of DX-002. When the *dominant* share of query
 * executions fans out (≥ `structuralPct`) across ≥ `minPartitions` physical partitions, the problem is the
 * partition key itself (the data model), not individual queries — the fix is to re-key the container
 * (migration-class). Reuses DX-002's fan-out signal. When this fires it **supersedes** DX-002 on the same
 * container (the caller drops the DX-002 advisory). Container-scoped. Pure.
 */
function evaluateShardKeyMisalignment(
    input: CrossPartitionInput,
    thresholds: ShardKeyThresholds,
    crossPartitionFanoutThreshold: number,
    minQueries: number = DIAGNOSTIC_POLICY.crossPartition.minQueries,
): DerivedAdvisory | undefined {
    const { totalQueries, containerPartitions, crossPartitionPct } = crossPartitionStats(
        input.shapes,
        crossPartitionFanoutThreshold,
    );
    const roundedCrossPartitionPct = Math.round(crossPartitionPct * 10) / 10;
    if (
        totalQueries < minQueries ||
        roundedCrossPartitionPct < thresholds.structuralPct ||
        containerPartitions < thresholds.minPartitions
    ) {
        return undefined;
    }
    const severity: DerivedAdvisorySeverity = roundedCrossPartitionPct >= thresholds.highPct ? 'High' : 'Medium';
    const pct = Math.round(roundedCrossPartitionPct);
    return {
        id: `ShardKeyMisalignment/${containerKey(input.databaseId, input.containerId)}`,
        rule: 'ShardKeyMisalignment',
        severity,
        scope: containerKey(input.databaseId, input.containerId),
        title: l10n.t('Partition key misaligned in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                "`{pct}%` of this container's query executions fan out across `~{partitions} physical partitions`.",
                {
                    pct,
                    partitions: containerPartitions,
                },
            ) +
                ' ' +
                l10n.t(
                    'The partition key is structurally misaligned with the workload (the data model, not a single bad query).',
                ),
        ),
        suggestedAction:
            l10n.t('Re-key the container so the dominant query filter becomes the partition key.') +
            ' ' +
            l10n.t(
                'This is migration-class: create a new container with the corrected key, backfill the data, and cut over.',
            ) +
            ' ' +
            l10n.t(
                'Per-query fixes cannot resolve a fundamentally mismatched key, and the cost grows as the container adds partitions.',
            ),
        thresholdReference: l10n.t('Threshold: ≥ `{pct}%` of executions fan out across ≥ `{partitions} partitions`', {
            pct: thresholds.structuralPct,
            partitions: thresholds.minPartitions,
        }),
    };
}

export class ShardKeyMisalignmentDetector extends Detector {
    readonly rule = 'ShardKeyMisalignment' as const;
    readonly supersedes = ['CrossPartitionQuery'] as const;
    evaluate = evaluateShardKeyMisalignment;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.crossPartition ?? []) {
            const a = this.evaluate(
                input,
                {
                    structuralPct: t.shardKeyStructuralPct,
                    minPartitions: DIAGNOSTIC_POLICY.shardKey.minPartitions,
                    highPct: t.shardKeyHighPct,
                },
                t.crossPartitionFanoutThreshold,
                t.crossPartitionMinQueries,
            );
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const shardKeyMisalignmentDetector = new ShardKeyMisalignmentDetector();
