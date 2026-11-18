/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { escapeAdvisoryText } from '../../../advisoryText';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext, type DetectorEvaluation } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type IndexingUsageInput } from '../core/types';

/**
 * IndexingCostRisk (best-effort): index storage is a large fraction of data
 * storage AND the container has no user exclusions. Pure.
 */
function evaluateIndexingCostRisk(input: IndexingUsageInput, ratioThreshold: number): DetectorEvaluation {
    const { indexUsageBytes, dataUsageBytes, userExcludedPathCount } = input;
    if (
        userExcludedPathCount > 0 ||
        dataUsageBytes === undefined ||
        dataUsageBytes <= 0 ||
        indexUsageBytes === undefined ||
        indexUsageBytes < 0
    ) {
        return { rootCause: userExcludedPathCount > 0 ? 'not_applicable' : 'insufficient_data' };
    }
    const ratio = indexUsageBytes / dataUsageBytes;
    if (ratio <= ratioThreshold) {
        return { rootCause: 'evaluated' };
    }
    const scope = containerKey(input.databaseId, input.containerId);
    const percent = Math.round(ratio * 100);
    const threshold = Math.round(ratioThreshold * 100);
    return {
        id: `IndexingCostRisk:${scope}`,
        rule: 'IndexingCostRisk',
        severity: 'Low',
        title: l10n.t('High indexing overhead in {container}', { container: input.containerId }),
        rationale: clampRationale(
            l10n.t(
                'Index storage in "{container}" is `{percent}%` of its data size, above the `{threshold}%` threshold, and the container has no user exclusions in its indexing policy. Indexing every property inflates storage and the RU cost of every write.',
                { container: escapeAdvisoryText(input.containerId), percent, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Exclude paths that are never used in filters from the indexing policy to cut write RU charges and index storage.',
        ),
        thresholdReference: l10n.t('Threshold: index/data storage > `{threshold}%`', { threshold }),
        scope,
    };
}

export class IndexingCostRiskDetector extends Detector {
    readonly rule = 'IndexingCostRisk' as const;
    protected readonly notApplicableRootCauses = ['not_applicable'];
    evaluate = (...args: Parameters<typeof evaluateIndexingCostRisk>) =>
        this.getAdvisory(evaluateIndexingCostRisk(...args));
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        return ctx.inputs.indexing.map((indexing) =>
            evaluateIndexingCostRisk(indexing, ctx.thresholds.indexingUsageRatio),
        );
    }
}

export const indexingCostRiskDetector = new IndexingCostRiskDetector();
