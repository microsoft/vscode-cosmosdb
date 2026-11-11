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
    input: UncontrolledIngestionInput | undefined,
    thresholds: UncontrolledIngestionThresholds,
): AdvisoryEvaluation<'UncontrolledIngestion'> {
    if (!input || input.totalRequests < thresholds.minRequests) {
        return { rootCause: 'insufficient_data' };
    }
    const writeRuPct = input.totalRu > 0 ? (100 * input.writeRu) / input.totalRu : 0;
    const throttleRate = input.totalRequests > 0 ? (100 * input.throttledRequests) / input.totalRequests : 0;
    if (writeRuPct < thresholds.writeRuPctFloor || throttleRate < thresholds.throttleRatePct) {
        return { rootCause: 'not_uncontrolled' };
    }
    const severity: DerivedAdvisorySeverity = throttleRate >= thresholds.highPct ? 'High' : 'Medium';
    const writePct = Math.round(writeRuPct);
    const throttlePct = Math.round(throttleRate);
    const client = input.dominantUserAgent
        ? l10n.t(' Dominant client: {client}.', { client: escapeAdvisoryText(input.dominantUserAgent) })
        : '';
    const advisory: DerivedAdvisory = {
        id: `UncontrolledIngestion/${containerKey(input.databaseId, input.containerId)}`,
        rule: 'UncontrolledIngestion',
        severity,
        scope: containerKey(input.databaseId, input.containerId),
        title: l10n.t('Uncontrolled ingestion in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'This container is write-dominant (`{writePct}%` of RU on writes) and throttling at `{throttlePct}%`.',
                {
                    writePct,
                    throttlePct,
                },
            ) +
                ' ' +
                l10n.t(
                    'The peak-to-average write burst is `~{burst}×` over `{interval}` buckets; burstiness is supporting evidence, not a trigger.',
                    {
                        burst: input.burstFactor.toFixed(1),
                        interval: input.requestLogEvidence?.sourceResolution === 'PT5M' ? '5m' : '1m',
                    },
                ) +
                client,
        ),
        suggestedAction:
            l10n.t(
                'Add application-side rate control rather than only provisioning for the peak. Bound ingestion concurrency and honor retry-after on 429.',
            ) +
            ' ' +
            l10n.t(
                'Use the SDK throughput-control feature (or the Spark connector) or throughput buckets to cap the batch path.',
            ) +
            ' ' +
            l10n.t('Run ingestion under low priority so it yields to app traffic.') +
            ' ' +
            l10n.t(
                'Smooth queued work instead of dumping bursts all at once. Raising RU/s is the complementary lever.',
            ),
        thresholdReference: l10n.t('Threshold: write-RU ≥ `{writePct}%` and 429 rate ≥ `{throttlePct}%`', {
            writePct: thresholds.writeRuPctFloor,
            throttlePct: thresholds.throttleRatePct,
        }),
        evidence: {
            writeRu: input.writeRu,
            totalRu: input.totalRu,
            totalRequests: input.totalRequests,
            throttledRequests: input.throttledRequests,
            burstFactor: input.burstFactor,
            ...input.requestLogEvidence,
        },
    };
    return { rootCause: 'uncontrolled_ingestion', advisory };
}

export class UncontrolledIngestionDetector extends Detector {
    readonly rule = 'UncontrolledIngestion' as const;
    evaluateResult = evaluateUncontrolledIngestion;
    evaluate = (...args: Parameters<typeof evaluateUncontrolledIngestion>) =>
        evaluateUncontrolledIngestion(...args).advisory;
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
