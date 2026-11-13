/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import {
    type AdvisoryEvaluation,
    type CrossPartitionInput,
    type CrossPartitionThresholds,
    type DerivedAdvisory,
} from '../core/types';
import { fanoutRuDescription, fanoutRuEvidence, fanoutSeverity, fanoutStats } from './fanout';

/** Collapses whitespace and truncates an anonymized query shape for display. Pure. */
function shortQueryShape(text: string): string {
    const collapsed = text.split(/\s+/).filter(Boolean).join(' ');
    return collapsed.length > 200 ? collapsed.slice(0, 200) + '…' : collapsed;
}

/**
 * CrossPartitionQuery (CODA DX-002): query shapes that do not filter on the container's partition key fan out
 * across every physical partition, multiplying RU and latency. Fires when the container has ≥ 2 physical
 * partitions, there is enough query traffic (`minQueries`), and the share of executions whose shape fans out
 * (average ≥ `fanoutThreshold` partitions) is at or above `medPct`, with at least 0.1 fan-out queries/s.
 * Severity uses physical-partition count and the unrounded fan-out rate. The
 * surfaced text is the service-anonymized shape, so remediation is structural (add the partition key to the
 * filter). Container-scoped. Pure.
 */
function evaluateCrossPartitionQuery(
    input: CrossPartitionInput,
    thresholds: CrossPartitionThresholds,
): AdvisoryEvaluation<'CrossPartitionQuery'> {
    const stats = fanoutStats(input, thresholds.fanoutThreshold);
    if (!stats) {
        return { rootCause: 'insufficient_data' };
    }
    const { totalQueries, containerPartitions, crossPartitionPct, crossQueriesPerSecond, worst } = stats;
    if (totalQueries < thresholds.minQueries) {
        return { rootCause: 'insufficient_data' };
    }
    if (containerPartitions <= 1) {
        return { rootCause: 'single_partition_container' };
    }
    if (crossPartitionPct < thresholds.medPct || worst === undefined) {
        return { rootCause: 'mostly_single_partition' };
    }
    if (crossQueriesPerSecond < DIAGNOSTIC_POLICY.crossPartition.minQueriesPerSecond) {
        return { rootCause: 'occasional_fanout' };
    }
    const severity = fanoutSeverity(containerPartitions, crossQueriesPerSecond);
    const pct = Math.round(crossPartitionPct);
    const shape = shortQueryShape(worst.text);
    const advisory: DerivedAdvisory = {
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
                "Include the container's partition key in the query filter where the access pattern permits. A composite index alone does not eliminate fan-out.",
            ) +
            ' ' +
            l10n.t(
                'For access patterns that inherently filter on a different key, serve them from a global secondary index or a change-feed-synced copy.',
            ) +
            ' ' +
            l10n.t('Cross-partition fan-out multiplies RU and latency and does not scale as the container grows.') +
            fanoutRuDescription(worst),
        evidence: {
            totalQueries,
            containerPartitions,
            crossPartitionPct,
            crossQueriesPerSecond,
            ...fanoutRuEvidence(input, worst),
        },
        thresholdReference: l10n.t(
            'Threshold: ≥ `{pct}%` fan-out share, avg ≥ `{fanout} partitions/query`, and ≥ `0.1 fan-out queries/s`',
            {
                pct: thresholds.medPct,
                fanout: thresholds.fanoutThreshold,
            },
        ),
    };
    return { rootCause: 'cross_partition', advisory };
}

export class CrossPartitionQueryDetector extends Detector {
    readonly rule = 'CrossPartitionQuery' as const;
    evaluateResult = evaluateCrossPartitionQuery;
    evaluate = (...args: Parameters<typeof evaluateCrossPartitionQuery>) =>
        evaluateCrossPartitionQuery(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.crossPartition ?? []) {
            const a = this.evaluate(input, {
                minQueries: t.crossPartitionMinQueries,
                fanoutThreshold: t.crossPartitionFanoutThreshold,
                medPct: t.crossPartitionMedPct,
            });
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const crossPartitionQueryDetector = new CrossPartitionQueryDetector();
