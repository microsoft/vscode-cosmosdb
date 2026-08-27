/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { containerKey } from '../../shared';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type DerivedAdvisory, type IndexingUsageInput } from '../core/types';

/**
 * IndexingCostRisk (best-effort): index storage is a large fraction of data
 * storage AND the container excludes no paths (indexes everything). Pure.
 */
function evaluateIndexingCostRisk(input: IndexingUsageInput, ratioThreshold: number): DerivedAdvisory | undefined {
    const { indexUsageBytes, dataUsageBytes, excludedPathCount } = input;
    if (
        excludedPathCount > 0 ||
        dataUsageBytes === undefined ||
        dataUsageBytes <= 0 ||
        indexUsageBytes === undefined ||
        indexUsageBytes < 0
    ) {
        return undefined;
    }
    const ratio = indexUsageBytes / dataUsageBytes;
    if (ratio <= ratioThreshold) {
        return undefined;
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
                'Index storage in "{container}" is {percent}% of its data size, above the {threshold}% threshold, and the container indexes every path (no exclusions). Indexing every property inflates storage and the RU cost of every write.',
                { container: input.containerId, percent, threshold },
            ),
        ),
        suggestedAction: l10n.t(
            'Exclude paths that are never used in filters from the indexing policy to cut write RU charges and index storage.',
        ),
        thresholdReference: l10n.t('Threshold: index/data storage > {threshold}%', { threshold }),
        scope,
    };
}

export class IndexingCostRiskDetector extends Detector {
    readonly rule = 'IndexingCostRisk' as const;
    evaluate = evaluateIndexingCostRisk;
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
