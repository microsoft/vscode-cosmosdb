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
    daysToStorageLimit,
    GIB,
    latestBytes,
    PARTITION_STORAGE_LIMIT_BYTES,
    STORAGE_GROWTH_HIGH_DAYS,
    STORAGE_GROWTH_MEDIUM_DAYS,
    STORAGE_GROWTH_MIN_MATERIAL_BYTES,
    STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY,
    storageGrowthSlopeBytesPerDay,
} from './storageMath';

/**
 * StorageGrowthRisk (best-effort): the soonest-to-fill physical partition in a
 * container is on a least-squares trajectory to the 50 GiB split ceiling within
 * the configured horizon. Unlike an absolute bytes-added trigger, this answers
 * "how soon do you hit the wall" — a 2 TB container adding 10 GiB/week spread over
 * dozens of partitions is decades away and does not fire, while a 40 GiB partition
 * growing steadily does. Immaterial (< 1 GiB) and flat/noisy (< 0.1 GiB/day)
 * partitions are ignored. Severity grades by horizon. Pure.
 */
function evaluateStorageGrowthRisk(input: ContainerStorageInput, horizonDays: number): DerivedAdvisory | undefined {
    if (horizonDays <= 0) {
        return undefined;
    }
    let soonest: { days: number; currentBytes: number; slopeBytesPerDay: number } | undefined;
    for (const partition of input.partitions) {
        const currentBytes = latestBytes(partition);
        if (currentBytes === undefined || currentBytes < STORAGE_GROWTH_MIN_MATERIAL_BYTES) {
            continue;
        }
        const slopeBytesPerDay = storageGrowthSlopeBytesPerDay(partition.samples);
        if (slopeBytesPerDay === undefined || slopeBytesPerDay < STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY) {
            continue;
        }
        const days = daysToStorageLimit(currentBytes, slopeBytesPerDay, PARTITION_STORAGE_LIMIT_BYTES);
        if (days === undefined) {
            continue;
        }
        if (soonest === undefined || days < soonest.days) {
            soonest = { days, currentBytes, slopeBytesPerDay };
        }
    }
    if (soonest === undefined || soonest.days > horizonDays) {
        return undefined;
    }

    const severity: DerivedAdvisorySeverity =
        soonest.days <= STORAGE_GROWTH_HIGH_DAYS
            ? 'High'
            : soonest.days <= STORAGE_GROWTH_MEDIUM_DAYS
              ? 'Medium'
              : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const days = Math.max(0, Math.round(soonest.days));
    const currentGiB = Math.round((soonest.currentBytes / GIB) * 10) / 10;
    const perDayGiB = Math.round((soonest.slopeBytesPerDay / GIB) * 100) / 100;
    const horizon = Math.round(horizonDays);
    return {
        id: `StorageGrowthRisk:${scope}`,
        rule: 'StorageGrowthRisk',
        severity,
        title: l10n.t('Physical partition approaching its storage limit in {container}', {
            container: input.containerId,
        }),
        rationale: clampRationale(
            l10n.t(
                'The fastest-growing physical partition in "{container}" is at {current} GiB and growing about {perDay} GiB/day. On that trajectory it reaches the 50 GiB physical-partition split ceiling in roughly {days} days, within the {horizon}-day risk horizon. A partition that hits the wall can throttle or block writes until it splits.',
                { container: input.containerId, current: currentGiB, perDay: perDayGiB, days, horizon },
            ),
        ),
        suggestedAction: l10n.t(
            'Confirm the partition key spreads new data across partitions, archive or delete cold data, and ensure large logical keys stay well under the 20 GiB per-key cap so partitions split cleanly.',
        ),
        thresholdReference: l10n.t('Threshold: projected < {horizon} days to the 50 GiB partition ceiling', {
            horizon,
        }),
        scope,
    };
}

export class StorageGrowthRiskDetector extends Detector {
    readonly rule = 'StorageGrowthRisk' as const;
    evaluate = evaluateStorageGrowthRisk;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const storage of ctx.inputs.storage) {
            const a = this.evaluate(storage, ctx.thresholds.storageGrowthHorizonDays);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const storageGrowthRiskDetector = new StorageGrowthRiskDetector();
