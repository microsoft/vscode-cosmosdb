/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import {
    type AdvisoryEvaluation,
    type ContainerStorageInput,
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
} from '../core/types';
import {
    daysToStorageLimit,
    fitStorageGrowth,
    GIB,
    latestBytes,
    PARTITION_STORAGE_LIMIT_BYTES,
    STORAGE_GROWTH_HIGH_DAYS,
    STORAGE_GROWTH_MEDIUM_DAYS,
    STORAGE_GROWTH_MIN_MATERIAL_BYTES,
    STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY,
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
function evaluateStorageGrowthRisk(
    input: ContainerStorageInput,
    horizonDays: number,
): AdvisoryEvaluation<'StorageGrowthRisk'> {
    if (horizonDays <= 0) {
        return { rootCause: 'stable' };
    }
    let soonest:
        | {
              days: number;
              currentBytes: number;
              slopeBytesPerDay: number;
              roundoffBytesPerDay: number;
              atOrOverLimit: boolean;
          }
        | undefined;
    let largestObserved = 0;
    let missingHistory = false;
    for (const partition of input.partitions) {
        const currentBytes = latestBytes(partition);
        if (currentBytes !== undefined) {
            largestObserved = Math.max(largestObserved, currentBytes);
        }
        if (currentBytes === undefined) {
            missingHistory = true;
            continue;
        }
        if (currentBytes < STORAGE_GROWTH_MIN_MATERIAL_BYTES) {
            continue;
        }
        if (currentBytes >= PARTITION_STORAGE_LIMIT_BYTES) {
            const atLimit = { days: 0, currentBytes, slopeBytesPerDay: 0, roundoffBytesPerDay: 0, atOrOverLimit: true };
            if (soonest === undefined || !soonest.atOrOverLimit || currentBytes > soonest.currentBytes) {
                soonest = atLimit;
            }
            continue;
        }
        const trend = fitStorageGrowth(partition.samples);
        if (trend === undefined) {
            missingHistory = true;
            continue;
        }
        if (trend.slopeBytesPerDay + trend.roundoffBytesPerDay < STORAGE_GROWTH_MIN_SLOPE_BYTES_PER_DAY) {
            continue;
        }
        const { slopeBytesPerDay } = trend;
        const days = daysToStorageLimit(currentBytes, slopeBytesPerDay, PARTITION_STORAGE_LIMIT_BYTES);
        if (days === undefined) {
            continue;
        }
        if (soonest === undefined || (!soonest.atOrOverLimit && days < soonest.days)) {
            soonest = {
                days,
                currentBytes,
                slopeBytesPerDay,
                roundoffBytesPerDay: trend.roundoffBytesPerDay,
                atOrOverLimit: false,
            };
        }
    }
    // Compare in bytes/day so the same regression roundoff protects every inclusive boundary.
    const reachesWithinDays = (days: number): boolean =>
        soonest !== undefined &&
        (soonest.atOrOverLimit ||
            soonest.slopeBytesPerDay + soonest.roundoffBytesPerDay >=
                (PARTITION_STORAGE_LIMIT_BYTES - soonest.currentBytes) / days);
    if (soonest === undefined || !reachesWithinDays(horizonDays)) {
        return {
            rootCause:
                missingHistory || largestObserved <= 0
                    ? 'insufficient_data'
                    : largestObserved < STORAGE_GROWTH_MIN_MATERIAL_BYTES
                      ? 'too_small'
                      : 'stable',
        };
    }

    if (soonest.atOrOverLimit) {
        const scope = containerKey(input.databaseId, input.containerId);
        const currentGiB = Math.round((soonest.currentBytes / GIB) * 10) / 10;
        const advisory: DerivedAdvisory = {
            id: `StorageGrowthRisk:${scope}`,
            rule: 'StorageGrowthRisk',
            severity: 'High',
            title: l10n.t('Physical partition at or above its storage limit in {container}', {
                container: input.containerId,
            }),
            rationale: clampRationale(
                l10n.t(
                    'The fullest physical partition in "{container}" is already at `{current} GiB`, at or above the `50 GiB` physical-partition ceiling.',
                    { container: escapeAdvisoryText(input.containerId), current: currentGiB },
                ) +
                    ' ' +
                    l10n.t(
                        'That is the most urgent storage-growth case even if the recent trend is flat or shrinking.',
                    ),
            ),
            suggestedAction:
                l10n.t(
                    'Investigate this container urgently: archive or delete cold data and add TTL where appropriate.',
                ) +
                ' ' +
                l10n.t('Confirm no oversized logical key is blocking healthy splits.'),
            thresholdReference: l10n.t('Threshold: current partition size ≥ `50 GiB`'),
            scope,
        };
        return { rootCause: 'at_or_over_limit', advisory, observations: { daysToLimit: 0 } };
    }

    const severity: DerivedAdvisorySeverity = reachesWithinDays(STORAGE_GROWTH_HIGH_DAYS)
        ? 'High'
        : reachesWithinDays(STORAGE_GROWTH_MEDIUM_DAYS)
          ? 'Medium'
          : 'Low';
    const scope = containerKey(input.databaseId, input.containerId);
    const days = Math.max(0, Math.round(soonest.days));
    const currentGiB = Math.round((soonest.currentBytes / GIB) * 10) / 10;
    const perDayGiB = Math.round((soonest.slopeBytesPerDay / GIB) * 100) / 100;
    const horizon = Math.round(horizonDays);
    const advisory: DerivedAdvisory = {
        id: `StorageGrowthRisk:${scope}`,
        rule: 'StorageGrowthRisk',
        severity,
        title: l10n.t('Physical partition approaching its storage limit in {container}', {
            container: input.containerId,
        }),
        rationale: clampRationale(
            l10n.t(
                'The fastest-growing physical partition in "{container}" is at `{current} GiB` and growing about `{perDay} GiB/day`.',
                { container: escapeAdvisoryText(input.containerId), current: currentGiB, perDay: perDayGiB },
            ) +
                ' ' +
                l10n.t(
                    'On that trajectory it reaches the `50 GiB` physical-partition split ceiling in roughly `{days} days`, within the `{horizon}-day` risk horizon.',
                    { days, horizon },
                ) +
                ' ' +
                l10n.t('A partition that hits the wall can throttle or block writes until it splits.'),
        ),
        suggestedAction:
            l10n.t('Confirm the partition key spreads new data across partitions, and archive or delete cold data.') +
            ' ' +
            l10n.t('Ensure large logical keys stay well under the `20 GiB` per-key cap so partitions split cleanly.'),
        thresholdReference: l10n.t('Threshold: projected ≤ `{horizon} days` to the `50 GiB` partition ceiling', {
            horizon,
        }),
        scope,
    };
    return { rootCause: 'rapid_growth', advisory, observations: { daysToLimit: soonest.days } };
}

export class StorageGrowthRiskDetector extends Detector {
    readonly rule = 'StorageGrowthRisk' as const;
    evaluateResult = evaluateStorageGrowthRisk;
    evaluate = (...args: Parameters<typeof evaluateStorageGrowthRisk>) => evaluateStorageGrowthRisk(...args).advisory;
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
