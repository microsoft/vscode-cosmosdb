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
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
    type PartitionMergeInput,
} from '../core/types';
import { GIB } from './storageMath';

// DX-009: each physical partition serves up to 10,000 RU/s and stores up to 50 GiB. Both are Azure platform
// limits, so the needed-partition math below is grounded rather than a heuristic:
// https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions
const RU_PER_PARTITION = 10_000;
const BYTES_PER_PARTITION = 50 * GIB;

/** The smallest physical-partition count that satisfies both the RU/s and storage needs (CODA DX-009). Pure. */
function neededPartitions(provisionedRu: number, storageBytes: number): number {
    const forRu = provisionedRu > 0 ? Math.ceil(provisionedRu / RU_PER_PARTITION) : 1;
    const forStorage = storageBytes > 0 ? Math.ceil(storageBytes / BYTES_PER_PARTITION) : 1;
    return Math.max(forRu, forStorage, 1);
}

/**
 * PartitionMergeCandidate (CODA DX-009): a container has **more physical partitions than its throughput and
 * storage need** — typically a leftover from once having been scaled to a high RU/s (or large) and then scaled
 * back down. Each partition then gets a thin slice of RU/s, so a single hot partition can throttle while the
 * container as a whole looks under-utilised. `needed = max(ceil(RU / 10,000), ceil(bytes / 50 GiB), 1)`; the
 * container is over-partitioned when `actual > needed` and `actual ≥ 2` (a single partition is never flagged).
 * Severity is Medium when actual ≥ 2× needed (the slice is very thin), else Low. Merge is a platform operation.
 * Pure.
 */
function evaluatePartitionMergeCandidate(input: PartitionMergeInput): AdvisoryEvaluation<'PartitionMergeCandidate'> {
    const actual = input.actualPartitions;
    // 0 ⇒ no partition reading (insufficient data); 1 ⇒ single partition can never be merged.
    if (
        !Number.isInteger(actual) ||
        actual < 1 ||
        input.provisionedRu === undefined ||
        !Number.isFinite(input.provisionedRu) ||
        input.provisionedRu < 0 ||
        input.dataUsageBytes === undefined ||
        !Number.isFinite(input.dataUsageBytes) ||
        input.dataUsageBytes < 0
    ) {
        return { rootCause: 'insufficient_data' };
    }
    if (actual === 1) {
        return { rootCause: 'single_partition' };
    }
    const provisionedRu = input.provisionedRu;
    const storageBytes = input.dataUsageBytes;
    const needed = neededPartitions(provisionedRu, storageBytes);
    if (actual <= needed) {
        return { rootCause: 'right_sized' };
    }
    const severity: DerivedAdvisorySeverity =
        actual >= DIAGNOSTIC_POLICY.partitionMerge.mediumExcessRatio * needed ? 'Medium' : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const ruSlice = provisionedRu > 0 ? Math.round(provisionedRu / actual) : 0;
    const gib = Math.round((storageBytes / GIB) * 10) / 10;
    const policy = input.backupPolicy;
    const backupType = policy?.type?.toLowerCase();
    const blocked = backupType === 'continuous' || policy?.fullFidelityChangeFeedEnabled === true;
    const migration = policy?.migrationState;
    const settledPeriodic =
        backupType === 'periodic' &&
        (migration === undefined ||
            (migration.status?.toLowerCase() === 'completed' && migration.targetType?.toLowerCase() === 'periodic'));
    const eligibility =
        backupType === 'continuous'
            ? 'blocked_pitr'
            : policy?.fullFidelityChangeFeedEnabled === true
              ? 'blocked_full_fidelity'
              : settledPeriodic
                ? 'requires_platform_validation'
                : 'unknown';
    const advisory: DerivedAdvisory = {
        id: `PartitionMergeCandidate:${scope}`,
        rule: 'PartitionMergeCandidate',
        severity,
        title: l10n.t('Container may be over-partitioned'),
        rationale: clampRationale(
            l10n.t(
                'Container "{container}" has `{actual} physical partitions` but its `{ru} RU/s` and `{gib} GiB` only need `{needed}`.',
                {
                    container: escapeAdvisoryText(input.containerId),
                    actual,
                    ru: Math.round(provisionedRu),
                    gib,
                    needed,
                },
            ) +
                ' ' +
                l10n.t(
                    'Each partition gets just `~{slice} RU/s`, so a hot partition can throttle while the container looks under-utilised.',
                    { slice: ruSlice },
                ) +
                ' ' +
                l10n.t(
                    'This usually follows scaling RU/s down (or deleting data) after a high-throughput or large period.',
                ),
        ),
        evidence: {
            actualPartitions: actual,
            neededPartitions: needed,
            provisionedRu,
            dataUsageBytes: storageBytes,
            backupType: backupType ?? 'unknown',
            mergeEligibility: eligibility,
        },
        actionEligibility: blocked ? 'blocked' : settledPeriodic ? 'requiresValidation' : 'unknown',
        suggestedAction: blocked
            ? l10n.t(
                  'Partition merge is blocked by continuous backup or conflicting all-versions-and-deletes metadata. Continuous backup cannot be reverted to periodic backup. Do not disable protection to enable a merge.',
              ) +
              (policy?.fullFidelityChangeFeedEnabled === true
                  ? ' ' +
                    l10n.t(
                        'All-versions-and-deletes change feed requires continuous backup; enablement does not establish active consumer usage. Resolve inconsistent or missing backup metadata without weakening protection.',
                    )
                  : '')
            : settledPeriodic
              ? l10n.t(
                    'Use the Azure Portal merge eligibility checker and verify current platform, SDK and connector restrictions. Periodic backup alone does not establish eligibility. Only after those checks should a merge be considered.',
                )
              : l10n.t(
                    'Merge eligibility is unknown because backup policy is missing or migration metadata is present and unsettled. Verify the account state; merge instructions are withheld.',
                ),
        thresholdReference: l10n.t(
            'Threshold: physical partitions > max(ceil(RU/`10,000`), ceil(storage/`50 GiB`), `1`)',
        ),
        scope,
    };
    return { rootCause: 'over_partitioned', advisory, observations: { mergeEligibility: eligibility } };
}

export class PartitionMergeCandidateDetector extends Detector {
    readonly rule = 'PartitionMergeCandidate' as const;
    evaluateResult = evaluatePartitionMergeCandidate;
    evaluate = (...args: Parameters<typeof evaluatePartitionMergeCandidate>) =>
        evaluatePartitionMergeCandidate(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const merge of ctx.inputs.partitionMerges ?? []) {
            const a = this.evaluate(merge);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const partitionMergeCandidateDetector = new PartitionMergeCandidateDetector();
