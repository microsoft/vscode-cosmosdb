/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { percentile } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type DerivedAdvisorySeverity } from '../core/types';

/** Do not flag over-provisioning when the busiest sample reached this % — a recurring batch needs peak capacity. */
const OVERPROVISIONING_PEAK_GUARD_PCT = 90;
/** Headroom multiplier applied to observed p99 demand when sizing the right-size target (CODA DX-001). */
const OVERPROVISIONING_HEADROOM = 1.3;
// Platform minimum RU/s floor a right-size recommendation never drops below — a container's minimum manual
// throughput is 400 RU/s:
// https://learn.microsoft.com/azure/cosmos-db/set-throughput
const OVERPROVISIONING_MIN_RU = 400;
/** Wasted RU/s as % of scope provisioned RU/s at or above which severity is High. */
const OVERPROVISIONING_MATERIAL_HIGH_PCT = 5;
/** Wasted RU/s as % of scope provisioned RU/s at or above which severity is Medium (below this, Low). */
const OVERPROVISIONING_MATERIAL_MEDIUM_PCT = 1;

/**
 * OverProvisioning (CODA DX-001): sustained low **p99** RU on manual throughput over the trailing 7 days, banded
 * below the moderate threshold. Two guards keep it from firing on workloads that genuinely need their capacity: the
 * p99 band ignores brief spikes, and a **peak-saturation guard** suppresses the finding when the busiest sample
 * saturated capacity (a recurring batch needs that peak). Severity is **relative materiality** — wasted RU/s as a
 * share of the scope's provisioned RU/s (the same waste is material against a small account but trivial against a
 * fleet) — falling back to absolute wasted RU/s when the scope total is unknown. The right-size target covers p99
 * demand plus headroom and never drops below the observed peak, so it can never throttle a real spike. Pure.
 */
function evaluateOverProvisioning(
    p99Percent: number | undefined,
    peakPercent: number | undefined,
    thresholdPercent: number,
    hasManualThroughput: boolean,
    provisionedRuTotal?: number,
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || p99Percent === undefined || p99Percent >= thresholdPercent) {
        return undefined;
    }
    // Peak-saturation guard: a workload whose busiest sample saturates capacity genuinely needs it at peak.
    if (peakPercent !== undefined && peakPercent >= OVERPROVISIONING_PEAK_GUARD_PCT) {
        return undefined;
    }
    const p99 = Math.round(p99Percent);
    const threshold = Math.round(thresholdPercent);

    let wastedRu: number | undefined;
    let severity: DerivedAdvisorySeverity = 'Medium';
    if (provisionedRuTotal !== undefined && provisionedRuTotal > 0) {
        const consumedAtP99 = (p99Percent / 100) * provisionedRuTotal;
        const peakConsumed = ((peakPercent ?? p99Percent) / 100) * provisionedRuTotal;
        const recommended = Math.min(
            provisionedRuTotal,
            Math.max(
                OVERPROVISIONING_MIN_RU,
                Math.ceil(consumedAtP99 * OVERPROVISIONING_HEADROOM),
                Math.ceil(peakConsumed),
            ),
        );
        wastedRu = Math.max(0, Math.round(provisionedRuTotal - recommended));
        const materialityPct = (wastedRu / provisionedRuTotal) * 100;
        severity =
            materialityPct >= OVERPROVISIONING_MATERIAL_HIGH_PCT
                ? 'High'
                : materialityPct >= OVERPROVISIONING_MATERIAL_MEDIUM_PCT
                  ? 'Medium'
                  : 'Low';
    }

    const materiality =
        wastedRu !== undefined
            ? l10n.t(' That is roughly {wasted} RU/s of provisioned capacity the workload never uses.', {
                  wasted: wastedRu.toLocaleString(),
              })
            : '';

    return {
        id: 'OverProvisioning',
        rule: 'OverProvisioning',
        severity,
        title: l10n.t('Throughput may be over-provisioned'),
        rationale: clampRationale(
            l10n.t(
                '99th-percentile normalized RU consumption stayed at {p99}% over the last 7 days, below the {threshold}% over-provisioning threshold, while at least one container uses manual throughput. Banding on p99 rather than the peak ignores brief spikes that do not reflect steady demand.',
                { p99, threshold },
            ) + materiality,
        ),
        suggestedAction: l10n.t(
            'Lower provisioned RU/s to match observed demand, or switch to autoscale so capacity tracks usage automatically.',
        ),
        thresholdReference: l10n.t('Threshold: 7-day p99 < {threshold}% RU', { threshold }),
    };
}

export class OverProvisioningDetector extends Detector {
    readonly rule = 'OverProvisioning' as const;
    evaluate = evaluateOverProvisioning;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const { inputs, thresholds } = ctx;
        const advisory = this.evaluate(
            percentile(inputs.weeklyRuPercents, 99),
            inputs.weeklyPeakPercent ??
                (inputs.weeklyRuPercents.length > 0 ? Math.max(...inputs.weeklyRuPercents) : undefined),
            thresholds.overProvisioningBandPercent,
            inputs.hasManualThroughput,
            inputs.manualProvisionedRuTotal,
        );
        return advisory ? [advisory] : [];
    }
}

export const overProvisioningDetector = new OverProvisioningDetector();
