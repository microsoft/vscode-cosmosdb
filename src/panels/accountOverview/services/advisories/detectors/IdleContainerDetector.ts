/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type ThroughputMode } from '../../inventory';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { capacityMaterialitySeverity, clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type IdleContainerInput } from '../core/types';

// DX-004/011: autoscale bills between 10% and 100% of the configured max (`0.1*Tmax ≤ T ≤ Tmax`), so an idle
// or over-sized autoscale container only recovers its idle floor, never the full max:
// https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#how-autoscale-throughput-works
const AUTOSCALE_IDLE_FRACTION = 0.1;

/** Manual (non-autoscale, non-serverless) throughput modes that the over-provisioning/autoscale rules key on. */
const MANUAL_THROUGHPUT_MODES: ReadonlySet<ThroughputMode> = new Set<ThroughputMode>(['dedicated', 'shared']);

/**
 * IdleContainer (CODA DX-004): a container that is provisioned but serves ~no traffic — its whole reservation is
 * pure 24/7 waste. The signal is the **peak RU consumed in any single bucket** (`max(TotalRequestUnits, Total)`)
 * over a long 30-day window: a container that never spends more than a tiny system floor in *any* bucket did no
 * real work, so it is idle. This is deliberately spike-aware — a container silent for 29 days that runs one real
 * batch on day 30 shows a large peak and is correctly not flagged. Unlike the utilisation rules an empty/all-zero
 * series is the *positive* idle signal (Azure Monitor pads idle windows with zeros), not an abstention.
 * Mode-aware recoverable capacity: manual idle bills the full provisioned RU/s (all recoverable); autoscale idle
 * scales to ~10% of its max (that floor is what decommission recovers). Severity is capacity materiality. Pure.
 */
function evaluateIdleContainer(
    input: IdleContainerInput,
    maxIdlePeakRu: number,
    scopeProvisionedRu?: number,
): DerivedAdvisory | undefined {
    const isAutoscale = input.throughputMode === 'autoscale';
    const isManual = MANUAL_THROUGHPUT_MODES.has(input.throughputMode);
    // Only manual/autoscale containers have a provisioned offer to recover; serverless has none.
    if ((!isAutoscale && !isManual) || input.provisionedRu === undefined || input.provisionedRu <= 0) {
        return undefined;
    }
    // Consumed real RU in some bucket ⇒ active, not idle — DX-001 right-sizes it instead.
    if (input.peakRuPerBucket > maxIdlePeakRu) {
        return undefined;
    }
    const recoverableRu = isAutoscale ? AUTOSCALE_IDLE_FRACTION * input.provisionedRu : input.provisionedRu;
    const severity = capacityMaterialitySeverity(recoverableRu, scopeProvisionedRu);
    const scope = containerKey(input.databaseId, input.containerId);
    const peak = Math.round(input.peakRuPerBucket);
    const recoverable = Math.round(recoverableRu);
    const provisioned = Math.round(input.provisionedRu);
    const rationale = isAutoscale
        ? l10n.t(
              'Container "{container}" consumed at most {peak} RU in any single bucket over the last 30 days, at or below the {threshold} RU idle floor. It serves ~no traffic. Decommissioning it recovers the autoscale idle floor (~{recoverable} RU/s of its {provisioned} RU/s max).',
              { container: input.containerId, peak, threshold: Math.round(maxIdlePeakRu), recoverable, provisioned },
          )
        : l10n.t(
              'Container "{container}" consumed at most {peak} RU in any single bucket over the last 30 days, at or below the {threshold} RU idle floor. It serves ~no traffic. Its full {recoverable} RU/s provisioned capacity is recoverable.',
              { container: input.containerId, peak, threshold: Math.round(maxIdlePeakRu), recoverable },
          );
    return {
        id: `IdleContainer:${scope}`,
        rule: 'IdleContainer',
        severity,
        title: l10n.t('Container looks idle'),
        rationale: clampRationale(rationale),
        suggestedAction: l10n.t(
            'Review "{container}" for decommission, a TTL policy, or archival; confirm it is genuinely unused before removing it.',
            { container: input.containerId },
        ),
        thresholdReference: l10n.t('Threshold: peak ≤ {threshold} RU per bucket over 30 days', {
            threshold: Math.round(maxIdlePeakRu),
        }),
        scope,
    };
}

export class IdleContainerDetector extends Detector {
    readonly rule = 'IdleContainer' as const;
    evaluate = evaluateIdleContainer;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const idle of ctx.inputs.idleContainers ?? []) {
            const a = this.evaluate(idle, ctx.thresholds.idlePeakRuPerBucket, ctx.inputs.scopeProvisionedRuTotal);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const idleContainerDetector = new IdleContainerDetector();
