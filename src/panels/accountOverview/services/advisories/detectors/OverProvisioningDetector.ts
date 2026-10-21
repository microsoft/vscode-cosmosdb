/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { percentile } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import {
    capacityMaterialitySeverity,
    clampRationale,
    finiteNumbers,
    hasMinimumKnownResourceAge,
} from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisory, type ManualThroughputInput } from '../core/types';

// Platform minimum RU/s floor a right-size recommendation never drops below — a container's minimum manual
// throughput is 400 RU/s:
// https://learn.microsoft.com/azure/cosmos-db/set-throughput
const OVERPROVISIONING_MIN_RU = 400;

/**
 * OverProvisioning (CODA DX-001): sustained low **p99** RU on manual throughput over the trailing window, banded
 * below the moderate threshold. Two guards keep it from firing on workloads that genuinely need their capacity: the
 * p99 band ignores brief spikes, and a **peak-saturation guard** suppresses the finding when the busiest sample
 * saturated capacity. Severity is capacity materiality. Pure.
 */
function evaluateOverProvisioning(
    p99Percent: number | undefined,
    peakPercent: number | undefined,
    thresholdPercent: number,
    hasManualThroughput: boolean,
    provisionedRu?: number,
    scopeProvisionedRuTotal?: number,
    scope?: string,
    containerId?: string,
    observationLabel: string = l10n.t('7 days'),
): DerivedAdvisory | undefined {
    if (!hasManualThroughput || p99Percent === undefined || p99Percent >= thresholdPercent) {
        return undefined;
    }
    if (peakPercent !== undefined && peakPercent >= DIAGNOSTIC_POLICY.overProvisioning.peakGuardPercent) {
        return undefined;
    }
    const p99 = Math.round(p99Percent);
    const threshold = Math.round(thresholdPercent);

    let wastedRu: number | undefined;
    let wastedExact: number | undefined;
    let recommendedRu: number | undefined;
    if (provisionedRu !== undefined && provisionedRu > 0) {
        const consumedAtP99 = (p99Percent / 100) * provisionedRu;
        const peakConsumed = ((peakPercent ?? p99Percent) / 100) * provisionedRu;
        const recommended = Math.min(
            provisionedRu,
            Math.max(
                OVERPROVISIONING_MIN_RU,
                Math.ceil(consumedAtP99 * DIAGNOSTIC_POLICY.overProvisioning.headroomMultiplier),
                Math.ceil(peakConsumed),
            ),
        );
        recommendedRu = Math.round(recommended);
        wastedExact = Math.max(0, provisionedRu - recommended);
        wastedRu = Math.round(wastedExact);
    }
    const severity =
        wastedExact !== undefined
            ? capacityMaterialitySeverity(
                  wastedExact,
                  scope ? scopeProvisionedRuTotal : (scopeProvisionedRuTotal ?? provisionedRu),
              )
            : 'Medium';
    const materiality =
        wastedRu !== undefined && recommendedRu !== undefined
            ? l10n.t(
                  ' That leaves roughly `{wasted} RU/s` recoverable by lowering the offer toward `~{recommended} RU/s`.',
                  {
                      wasted: wastedRu.toLocaleString(),
                      recommended: recommendedRu.toLocaleString(),
                  },
              )
            : '';

    return {
        id: scope ? `OverProvisioning:${scope}` : 'OverProvisioning',
        rule: 'OverProvisioning',
        severity,
        title: containerId
            ? l10n.t('Throughput may be over-provisioned in {container}', { container: containerId })
            : l10n.t('Throughput may be over-provisioned'),
        rationale: clampRationale(
            (containerId
                ? l10n.t(
                      'Container "{container}" stayed at `{p99}%` 99th-percentile normalized RU over the last `{window}`.',
                      { container: escapeAdvisoryText(containerId), p99, window: observationLabel },
                  ) +
                  ' ' +
                  l10n.t('This is below the `{threshold}%` over-provisioning band.', { threshold })
                : l10n.t(
                      '99th-percentile normalized RU consumption stayed at `{p99}%` over the last `{window}`, below the `{threshold}%` over-provisioning threshold.',
                      { p99, window: observationLabel, threshold },
                  )) +
                l10n.t(
                    ' The busiest observed sample still stayed below the `90%` peak guard, so this looks steadily oversized rather than bursty.',
                ) +
                materiality,
        ),
        suggestedAction:
            containerId && recommendedRu !== undefined && provisionedRu !== undefined
                ? l10n.t(
                      'Lower "{container}" from `{provisioned} RU/s` toward `~{recommended} RU/s`, or switch it to autoscale if demand is bursty.',
                      {
                          container: escapeAdvisoryText(containerId),
                          provisioned: Math.round(provisionedRu).toLocaleString(),
                          recommended: recommendedRu.toLocaleString(),
                      },
                  )
                : l10n.t(
                      'Lower provisioned RU/s to match observed demand, or switch to autoscale so capacity tracks usage automatically.',
                  ),
        thresholdReference: l10n.t('Threshold: p99 RU < `{threshold}%` and peak < `90%`', { threshold }),
        scope,
    };
}

function evaluateManualThroughput(
    input: ManualThroughputInput,
    thresholdPercent: number,
    scopeProvisionedRuTotal?: number,
): DerivedAdvisory | undefined {
    const samples = finiteNumbers(input.ruPercents);
    if (
        samples.length < DIAGNOSTIC_POLICY.overProvisioning.minSamples ||
        !hasMinimumKnownResourceAge(input.resourceAgeDays, DIAGNOSTIC_POLICY.overProvisioning.minResourceAgeDays)
    ) {
        return undefined;
    }
    return evaluateOverProvisioning(
        percentile(samples, DIAGNOSTIC_POLICY.overProvisioning.percentile),
        input.peakPercent ?? (samples.length > 0 ? Math.max(...samples) : undefined),
        thresholdPercent,
        true,
        input.provisionedRu,
        scopeProvisionedRuTotal,
        `${input.databaseId}/${input.containerId}`,
        input.containerId,
        l10n.t('30 days'),
    );
}

export class OverProvisioningDetector extends Detector {
    readonly rule = 'OverProvisioning' as const;
    evaluate = evaluateOverProvisioning;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const { inputs, thresholds } = ctx;
        if (inputs.manualThroughput !== undefined) {
            return inputs.manualThroughput
                .map((input) =>
                    evaluateManualThroughput(
                        input,
                        thresholds.overProvisioningBandPercent,
                        inputs.scopeProvisionedRuTotal,
                    ),
                )
                .filter((advisory): advisory is DerivedAdvisory => advisory !== undefined);
        }
        const advisory = this.evaluate(
            percentile(inputs.weeklyRuPercents, DIAGNOSTIC_POLICY.overProvisioning.percentile),
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
