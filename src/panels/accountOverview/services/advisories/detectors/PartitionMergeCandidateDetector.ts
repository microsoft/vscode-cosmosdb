/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type PartitionMergeInput } from '../core/types';
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
function evaluatePartitionMergeCandidate(input: PartitionMergeInput): DerivedAdvisory | undefined {
    const actual = input.actualPartitions;
    // 0 ⇒ no partition reading (insufficient data); 1 ⇒ single partition can never be merged.
    if (actual <= 1) {
        return undefined;
    }
    const provisionedRu = input.provisionedRu ?? 0;
    const storageBytes = input.dataUsageBytes ?? 0;
    const needed = neededPartitions(provisionedRu, storageBytes);
    if (actual <= needed) {
        return undefined;
    }
    const severity: DerivedAdvisorySeverity = actual >= 2 * needed ? 'Medium' : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const ruSlice = provisionedRu > 0 ? Math.round(provisionedRu / actual) : 0;
    const gib = Math.round((storageBytes / GIB) * 10) / 10;
    return {
        id: `PartitionMergeCandidate:${scope}`,
        rule: 'PartitionMergeCandidate',
        severity,
        title: l10n.t('Container may be over-partitioned'),
        rationale: clampRationale(
            l10n.t(
                'Container "{container}" has {actual} physical partitions but its {ru} RU/s and {gib} GiB only need {needed}. Each partition therefore gets just ~{slice} RU/s, so a single hot partition can throttle while the container looks under-utilised. This usually follows scaling RU/s down (or deleting data) after a high-throughput or large period.',
                { container: input.containerId, actual, ru: Math.round(provisionedRu), gib, needed, slice: ruSlice },
            ),
        ),
        suggestedAction: l10n.t(
            'Merge the physical partitions (Azure Portal or CLI) to consolidate the RU/s back onto fewer partitions.',
        ),
        thresholdReference: l10n.t('Threshold: physical partitions > max(ceil(RU/10,000), ceil(storage/50 GiB), 1)'),
        scope,
    };
}

export class PartitionMergeCandidateDetector extends Detector {
    readonly rule = 'PartitionMergeCandidate' as const;
    evaluate = evaluatePartitionMergeCandidate;
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
