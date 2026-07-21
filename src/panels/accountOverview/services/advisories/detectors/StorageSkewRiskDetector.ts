/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type ContainerStorageInput, type DerivedAdvisory, type DerivedAdvisorySeverity } from '../core/types';
import {
    balanceRatio,
    GIB,
    latestBytes,
    PARTITION_STORAGE_LIMIT_BYTES,
    STORAGE_SKEW_HIGH_BYTES,
    STORAGE_SKEW_MEDIUM_BYTES,
    STORAGE_SKEW_MIN_BUSIEST_BYTES,
} from './storageMath';

/**
 * StorageSkewRisk (best-effort): physical-partition sizes are imbalanced
 * (`min/max` below the configured balance ratio) *and* the busiest partition is
 * material (≥ 1 GiB). Unlike a raw storage-share cutoff — which is
 * partition-count-dependent and size-blind (a balanced 40 MiB/60 MiB two-way
 * split trips a 35% share) — the balance ratio only fires on genuine imbalance,
 * and severity grades by the busiest partition's proximity to the 50 GiB split
 * ceiling (≥ 80% → High, ≥ 50% → Medium). Balanced-but-large partitions are
 * healthy: they simply split as they grow. Pure.
 */
function evaluateStorageSkewRisk(input: ContainerStorageInput, balanceThreshold: number): DerivedAdvisory | undefined {
    if (balanceThreshold <= 0) {
        return undefined;
    }
    const sizes = input.partitions
        .map((partition) => latestBytes(partition))
        .filter((bytes): bytes is number => bytes !== undefined);
    const ratio = balanceRatio(sizes);
    if (ratio === undefined || ratio >= balanceThreshold) {
        return undefined;
    }
    const busiestBytes = Math.max(...sizes);
    if (busiestBytes < STORAGE_SKEW_MIN_BUSIEST_BYTES) {
        return undefined;
    }

    const severity: DerivedAdvisorySeverity =
        busiestBytes >= STORAGE_SKEW_HIGH_BYTES ? 'High' : busiestBytes >= STORAGE_SKEW_MEDIUM_BYTES ? 'Medium' : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const busiestGiB = Math.round((busiestBytes / GIB) * 10) / 10;
    const balance = Math.round(ratio * 100) / 100;
    const threshold = Math.round(balanceThreshold * 100) / 100;
    const ceilingPercent = Math.round((busiestBytes / PARTITION_STORAGE_LIMIT_BYTES) * 100);
    return {
        id: `StorageSkewRisk:${scope}`,
        rule: 'StorageSkewRisk',
        severity,
        title: l10n.t('Uneven physical-partition storage in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'Physical-partition storage in "{container}" is uneven — the coolest partition holds only {balance}× the busiest (below the {threshold}× balance floor), and the busiest is at {busiest} GiB, about {ceiling}% of the 50 GiB split ceiling. A single oversized partition hits the split wall long before its balanced siblings, capping the container.',
                { container: input.containerId, balance, threshold, busiest: busiestGiB, ceiling: ceilingPercent },
            ),
        ),
        suggestedAction: l10n.t(
            'Review the partition key for a higher-cardinality choice so data spreads evenly, and split or archive the oversized logical keys concentrating storage on one partition.',
        ),
        thresholdReference: l10n.t('Threshold: min/max partition size < {threshold}× with busiest ≥ 1 GiB', {
            threshold,
        }),
        scope,
    };
}

export class StorageSkewRiskDetector extends Detector {
    readonly rule = 'StorageSkewRisk' as const;
    evaluate = evaluateStorageSkewRisk;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const storage of ctx.inputs.storage) {
            const a = this.evaluate(storage, ctx.thresholds.storageSkewBalanceRatio);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const storageSkewRiskDetector = new StorageSkewRiskDetector();
