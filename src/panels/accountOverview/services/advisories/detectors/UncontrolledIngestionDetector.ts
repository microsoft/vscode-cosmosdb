/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import {
    type DerivedAdvisory,
    type DerivedAdvisorySeverity,
    type UncontrolledIngestionInput,
    type UncontrolledIngestionThresholds,
} from '../core/types';

/**
 * UncontrolledIngestion (CODA DX-010): a write-dominant workload that is throttling — the signature of batch /
 * bulk / Spark loads outrunning the container's throughput. Fires when there is enough traffic (`minRequests`),
 * the write-RU share is ≥ `writeRuPctFloor`, AND the 429 rate is ≥ `throttleRatePct` (High at/above `highPct`).
 * The fix is application-side rate control, complementary to DX-005's "add RU/s". Container-scoped. Pure.
 */
function evaluateUncontrolledIngestion(
    input: UncontrolledIngestionInput,
    thresholds: UncontrolledIngestionThresholds,
): DerivedAdvisory | undefined {
    if (input.totalRequests < thresholds.minRequests) {
        return undefined;
    }
    const writeRuPct = input.totalRu > 0 ? (100 * input.writeRu) / input.totalRu : 0;
    const throttleRate = input.totalRequests > 0 ? (100 * input.throttledRequests) / input.totalRequests : 0;
    if (writeRuPct < thresholds.writeRuPctFloor || throttleRate < thresholds.throttleRatePct) {
        return undefined;
    }
    const severity: DerivedAdvisorySeverity = throttleRate >= thresholds.highPct ? 'High' : 'Medium';
    const writePct = Math.round(writeRuPct);
    const throttlePct = Math.round(throttleRate);
    const client = input.dominantUserAgent
        ? l10n.t(' Dominant client: {client}.', { client: input.dominantUserAgent })
        : '';
    return {
        id: `UncontrolledIngestion/${containerKey(input.databaseId, input.containerId)}`,
        rule: 'UncontrolledIngestion',
        severity,
        scope: containerKey(input.databaseId, input.containerId),
        title: l10n.t('Uncontrolled ingestion in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'This container is write-dominant ({writePct}% of RU on writes) and throttling at {throttlePct}% (peak-to-average write burst ~{burst}×), the signature of uncontrolled ingestion.',
                { writePct, throttlePct, burst: input.burstFactor.toFixed(1) },
            ) + client,
        ),
        suggestedAction: l10n.t(
            'Add application-side rate control rather than only provisioning for the peak: bound ingestion concurrency and honor retry-after on 429; use the SDK throughput-control feature (or the Spark connector) or throughput buckets to cap the batch path; and/or run ingestion under low priority so it yields to app traffic. Raising RU/s is the complementary lever.',
        ),
        thresholdReference: l10n.t('Threshold: write-RU ≥ {writePct}% and 429 rate ≥ {throttlePct}%', {
            writePct: thresholds.writeRuPctFloor,
            throttlePct: thresholds.throttleRatePct,
        }),
    };
}

export class UncontrolledIngestionDetector extends Detector {
    readonly rule = 'UncontrolledIngestion' as const;
    evaluate = evaluateUncontrolledIngestion;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const t = ctx.thresholds;
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.ingestion ?? []) {
            const a = this.evaluate(input, {
                writeRuPctFloor: t.ingestionWriteRuPctFloor,
                throttleRatePct: t.ingestionThrottleRatePct,
                highPct: t.ingestionHighPct,
                minRequests: t.ingestionMinRequests,
            });
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const uncontrolledIngestionDetector = new UncontrolledIngestionDetector();
