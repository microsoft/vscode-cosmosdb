/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AdvisoryEvaluation, type DerivedAdvisory, type IndexingUsageInput } from '../core/types';

/**
 * IndexingCostRisk (DX-024): index storage is a large fraction of data storage.
 * Exclusions are evidence, not a suppression gate or proof of unused indexes. Pure.
 */
function evaluateIndexingCostRisk(
    input: IndexingUsageInput,
    ratioThreshold: number,
): AdvisoryEvaluation<'IndexingCostRisk'> {
    const { indexUsageBytes, dataUsageBytes, userExcludedPathCount } = input;
    if (input.indexingMode?.toLowerCase() === 'none') {
        return { rootCause: 'indexing_disabled' };
    }
    if (
        dataUsageBytes === undefined ||
        !Number.isFinite(dataUsageBytes) ||
        dataUsageBytes <= 0 ||
        indexUsageBytes === undefined ||
        !Number.isFinite(indexUsageBytes) ||
        indexUsageBytes < 0
    ) {
        return { rootCause: 'insufficient_data' };
    }
    const ratio = indexUsageBytes / dataUsageBytes;
    if (ratio <= ratioThreshold) {
        return { rootCause: 'normal_ratio', observations: { indexDataRatio: ratio, userExcludedPathCount } };
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const percent = Math.round(ratio * 100);
    const threshold = Math.round(ratioThreshold * 100);
    const advisory: DerivedAdvisory = {
        id: `IndexingCostRisk:${scope}`,
        rule: 'IndexingCostRisk',
        severity: ratio > DIAGNOSTIC_POLICY.indexing.mediumRatio ? 'Medium' : 'Low',
        title: l10n.t('High indexing overhead in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'Index storage in "{container}" is `{percent}%` of its data size, above the `{threshold}%` threshold. This is a storage-footprint warning, not proof of unused indexes or measured write-RU savings.',
                { container: escapeAdvisoryText(input.containerId), percent, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Review actual filter and sort requirements before changing indexes. Composite, spatial and vector indexes can legitimately be large; do not exclude paths solely because this ratio is high.',
        ),
        evidence: { indexUsageBytes, dataUsageBytes, indexDataRatio: ratio, userExcludedPathCount },
        actionEligibility: 'requiresValidation',
        thresholdReference: l10n.t('Threshold: index/data storage > `{threshold}%`', { threshold }),
        scope,
    };
    return { rootCause: 'high_index_ratio', advisory, observations: { indexDataRatio: ratio, userExcludedPathCount } };
}

export class IndexingCostRiskDetector extends Detector {
    readonly rule = 'IndexingCostRisk' as const;
    evaluateResult = evaluateIndexingCostRisk;
    evaluate = (...args: Parameters<typeof evaluateIndexingCostRisk>) => evaluateIndexingCostRisk(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        const out: DerivedAdvisory[] = [];
        for (const indexing of ctx.inputs.indexing) {
            const a = this.evaluate(indexing, ctx.thresholds.indexingUsageRatio);
            if (a) {
                out.push(a);
            }
        }
        return out;
    }
}

export const indexingCostRiskDetector = new IndexingCostRiskDetector();
