/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type ServerlessThrottlingInput } from '../core/types';

const SERVERLESS_RU_PER_PARTITION = 5_000;

function evaluateServerlessThrottling(input: ServerlessThrottlingInput): DerivedAdvisory | undefined {
    if (input.totalRequests < DIAGNOSTIC_POLICY.serverlessThrottling.minRequests) {
        return undefined;
    }
    if (input.throttleRatePercent < DIAGNOSTIC_POLICY.serverlessThrottling.throttleRatePercent) {
        return undefined;
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const severity: DerivedAdvisorySeverity =
        input.throttleRatePercent >= DIAGNOSTIC_POLICY.serverlessThrottling.highThrottleRatePercent
            ? 'High'
            : input.throttleRatePercent >= DIAGNOSTIC_POLICY.serverlessThrottling.mediumThrottleRatePercent
              ? 'Medium'
              : 'Low';
    const rate = Math.round(input.throttleRatePercent * 10) / 10;
    return {
        id: `ServerlessThrottling:${scope}`,
        rule: 'ServerlessThrottling',
        severity,
        title: l10n.t('Serverless container is throttling in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                '"{container}" throttled {rate}% of requests over the last 7 days. Serverless has no throughput knob.',
                { container: input.containerId, rate },
            ) +
                ' ' +
                l10n.t(
                    'Bursts can still exceed the per-partition {limit} RU/s ceiling even when the average looks lower.',
                    { limit: SERVERLESS_RU_PER_PARTITION.toLocaleString() },
                ),
        ),
        suggestedAction:
            l10n.t(
                'Evaluate migrating "{container}" to provisioned throughput (manual or autoscale) for higher, predictable capacity.',
                { container: input.containerId },
            ) +
            ' ' +
            l10n.t(
                'Better partition-key distribution can help a multi-partition serverless container, but provisioned throughput is the reliable fix.',
            ),
        thresholdReference: l10n.t('Threshold: 429 rate ≥ {rate}% over at least {requests} requests', {
            rate: DIAGNOSTIC_POLICY.serverlessThrottling.throttleRatePercent,
            requests: DIAGNOSTIC_POLICY.serverlessThrottling.minRequests.toLocaleString(),
        }),
        scope,
    };
}

export class ServerlessThrottlingDetector extends Detector {
    readonly rule = 'ServerlessThrottling' as const;
    evaluate = evaluateServerlessThrottling;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const input of ctx.inputs.serverlessThrottling ?? []) {
            const advisory = this.evaluate(input);
            if (advisory) {
                out.push(advisory);
            }
        }
        return out;
    }
}

export const serverlessThrottlingDetector = new ServerlessThrottlingDetector();
