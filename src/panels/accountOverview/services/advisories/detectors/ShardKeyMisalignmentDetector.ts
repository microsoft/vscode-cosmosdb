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
    type AdvisoryEvaluation,
    type CrossPartitionInput,
    type DerivedAdvisory,
    type ShardKeyThresholds,
} from '../core/types';
import { fanoutRuDescription, fanoutRuEvidence, fanoutSeverity, fanoutStats } from './fanout';

/**
 * ShardKeyMisalignment (CODA DX-007): the structural escalation of DX-002. When the *dominant* share of query
 * executions fans out (≥ `structuralPct`) across ≥ `minPartitions` physical partitions, the problem is the
 * partition key itself (the data model), not individual queries — the fix is to re-key the container
 * (migration-class). Reuses DX-002's fan-out signal. When this fires it **supersedes** DX-002 on the same
 * container (the engine retains DX-002 as superseded evidence). Container-scoped. Pure.
 */
function evaluateShardKeyMisalignment(
    input: CrossPartitionInput,
    thresholds: ShardKeyThresholds,
    crossPartitionFanoutThreshold: number,
    minQueries: number = DIAGNOSTIC_POLICY.crossPartition.minQueries,
): AdvisoryEvaluation<'ShardKeyMisalignment'> {
    const stats = fanoutStats(input, crossPartitionFanoutThreshold);
    if (!stats) {
        return { rootCause: 'insufficient_data' };
    }
    const { totalQueries, containerPartitions, crossPartitionPct, crossQueriesPerSecond, worst } = stats;
    if (totalQueries < minQueries) {
        return { rootCause: 'insufficient_data' };
    }
    if (
        crossPartitionPct < thresholds.structuralPct ||
        crossQueriesPerSecond < DIAGNOSTIC_POLICY.crossPartition.minQueriesPerSecond ||
        containerPartitions < thresholds.minPartitions
    ) {
        return { rootCause: 'not_misaligned' };
    }
    const severity = fanoutSeverity(containerPartitions, crossQueriesPerSecond);
    const pct = Math.round(crossPartitionPct);
    const advisory: DerivedAdvisory = {
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
            ) +
            fanoutRuDescription(worst),
        evidence: {
            totalQueries,
            containerPartitions,
            crossPartitionPct,
            crossQueriesPerSecond,
            ...fanoutRuEvidence(input, worst),
        },
        thresholdReference: l10n.t(
            'Threshold: ≥ `{pct}%` fan-out share across ≥ `{partitions} partitions`, and ≥ `0.1 fan-out queries/s`',
            {
                pct: thresholds.structuralPct,
                partitions: thresholds.minPartitions,
            },
        ),
    };
    return { rootCause: 'shard_key_misaligned', advisory };
}

export class ShardKeyMisalignmentDetector extends Detector {
    readonly rule = 'ShardKeyMisalignment' as const;
    readonly supersedes = ['CrossPartitionQuery'] as const;
    evaluateResult = evaluateShardKeyMisalignment;
    evaluate = (...args: Parameters<typeof evaluateShardKeyMisalignment>) =>
        evaluateShardKeyMisalignment(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.crossPartition ?? []) {
            const a = this.evaluate(
                input,
                {
                    structuralPct: t.shardKeyStructuralPct,
                    minPartitions: DIAGNOSTIC_POLICY.shardKey.minPartitions,
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
