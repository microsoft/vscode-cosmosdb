/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { capacityMaterialitySeverity, clampRationale } from '../core/helpers';
import { type AutoscaleUtilizationInput, type DerivedAdvisory } from '../core/types';

/** Do not flag over-provisioning when the busiest sample reached this % — a recurring batch needs peak capacity. */
const OVERPROVISIONING_PEAK_GUARD_PCT = 90;
/** Headroom multiplier applied to observed p99 demand when sizing the right-size target (CODA DX-001). */
const OVERPROVISIONING_HEADROOM = 1.3;
// Platform minimum RU/s floor a right-size recommendation never drops below — a container's minimum manual
// throughput is 400 RU/s:
// https://learn.microsoft.com/azure/cosmos-db/set-throughput
const OVERPROVISIONING_MIN_RU = 400;

// DX-004/011: autoscale bills between 10% and 100% of the configured max (`0.1*Tmax ≤ T ≤ Tmax`), so an idle
// or over-sized autoscale container only recovers its idle floor, never the full max:
// https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#how-autoscale-throughput-works
const AUTOSCALE_IDLE_FRACTION = 0.1;

/**
 * AutoscaleMaxOverProvisioned (CODA DX-011): for autoscale, `NormalizedRUConsumption` measures against the
 * *currently-scaled* value, so it cannot tell whether the configured **max** is too high. The correct signal is
 * `AutoscaledRU` (what autoscale actually provisioned) as a % of the configured max. We band on the **peak** of
 * that series (autoscale's max must cover legitimate spikes, so lowering it below a real peak would throttle):
 * the max is over-provisioned when the busiest sample stayed below the moderate band. Autoscale bills the idle
 * floor (10% of max) even at zero load, so lowering the max only recovers the floor reduction, not the full
 * headroom. Severity is capacity materiality on that recoverable floor. Pure.
 */
function evaluateAutoscaleMaxOverProvisioned(
    input: AutoscaleUtilizationInput,
    bandPercent: number,
    scopeProvisionedRu?: number,
): DerivedAdvisory | undefined {
    if (input.sampleCount === 0 || input.configuredMaxRu === undefined || input.configuredMaxRu <= 0) {
        return undefined;
    }
    const peak = input.peakPercent;
    // Peak at/above the saturation guard, or at/above the moderate band, means the max is genuinely needed.
    if (peak >= OVERPROVISIONING_PEAK_GUARD_PCT || peak >= bandPercent) {
        return undefined;
    }
    const max = input.configuredMaxRu;
    const peakConsumed = (peak / 100) * max;
    const recommended = Math.min(
        max,
        Math.max(OVERPROVISIONING_MIN_RU, Math.ceil(peakConsumed * OVERPROVISIONING_HEADROOM), Math.ceil(peakConsumed)),
    );
    const floor = (ru: number): number => Math.max(OVERPROVISIONING_MIN_RU, AUTOSCALE_IDLE_FRACTION * ru);
    const wastedRu = Math.max(0, Math.round(floor(max) - floor(recommended)));
    const severity = capacityMaterialitySeverity(wastedRu, scopeProvisionedRu);
    const scope = containerKey(input.databaseId, input.containerId);
    const peakPct = Math.round(peak);
    const recommend = Math.round(recommended);
    return {
        id: `AutoscaleMaxOverProvisioned:${scope}`,
        rule: 'AutoscaleMaxOverProvisioned',
        severity,
        title: l10n.t('Autoscale max may be set too high'),
        rationale: clampRationale(
            l10n.t(
                'Autoscale on "{container}" never provisioned more than {peak}% of its {max} RU/s max over the window, below the {band}% band. Autoscale bills a 10% idle floor of the max even at zero load, so an over-high max wastes ~{wasted} RU/s of that floor.',
                {
                    container: input.containerId,
                    peak: peakPct,
                    max: Math.round(max),
                    band: Math.round(bandPercent),
                    wasted: wastedRu,
                },
            ),
        ),
        suggestedAction: l10n.t(
            'Lower the autoscale max toward the peak-provisioned level (≈ {recommended} RU/s) so the idle floor tracks real demand while still covering the peak.',
            { recommended: recommend },
        ),
        thresholdReference: l10n.t('Threshold: peak AutoscaledRU < {band}% of the configured max', {
            band: Math.round(bandPercent),
        }),
        scope,
    };
}

export class AutoscaleMaxOverProvisionedDetector extends Detector {
    readonly rule = 'AutoscaleMaxOverProvisioned' as const;
    evaluate = evaluateAutoscaleMaxOverProvisioned;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const util of ctx.inputs.autoscaleUtilizations ?? []) {
            const a = this.evaluate(
                util,
                ctx.thresholds.overProvisioningBandPercent,
                ctx.inputs.scopeProvisionedRuTotal,
            );
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const autoscaleMaxOverProvisionedDetector = new AutoscaleMaxOverProvisionedDetector();
