/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { classifyEnvironment } from '../../environmentClassifier';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { type AccountConfigInput, type DerivedAdvisory } from '../core/types';

/** Cosmos DB APIs whose drivers cannot use multi-region-write failover, so the flag is always a misconfiguration. */
const NON_MULTI_WRITE_APIS: ReadonlySet<string> = new Set(['mongo', 'cassandra', 'gremlin', 'table']);

const API_LABEL: Record<string, string> = {
    mongo: 'MongoDB',
    cassandra: 'Cassandra',
    gremlin: 'Gremlin',
    table: 'Table',
};

/**
 * MultiRegionWriteAntipattern (CODA DX-008): multi-region writes are enabled where the RTO=0 write-failover
 * benefit cannot or need not apply. The wrong-API case (Mongo/Cassandra/Gremlin/Table drivers cannot use the
 * failover) is highest confidence; a single write region with the flag set is a latent tripwire (no benefit today,
 * doubled write cost the moment a second write region is added); non-production with ≥ 2 write regions does not
 * need RTO=0 write failover. Two-or-more write regions in production is legitimate active-active HA and never
 * fires. Pure.
 */
function evaluateMultiRegionWrites(config: AccountConfigInput): DerivedAdvisory | undefined {
    if (!config.multiRegionWritesEnabled) {
        return undefined;
    }

    const base = { id: 'MultiRegionWriteAntipattern', rule: 'MultiRegionWriteAntipattern' as const };
    const disableAction = l10n.t('Disable multi-region writes unless the write-failover benefit genuinely applies.');

    // Wrong-API: the failover benefit is impossible regardless of environment — highest confidence.
    if (NON_MULTI_WRITE_APIS.has(config.apiKind)) {
        const apiLabel = API_LABEL[config.apiKind];
        return {
            ...base,
            severity: 'High',
            title: l10n.t('Multi-region writes on a {api} account', { api: apiLabel }),
            rationale: clampRationale(
                l10n.t(
                    'Multi-region writes are enabled on a {api} API account, but the {api} drivers cannot use Cosmos DB’s multi-region-write failover — so the RTO=0 HA benefit never materialises while the account still carries the write-conflict surface (and 2× write cost across any second write region).',
                    { api: apiLabel },
                ),
            ),
            suggestedAction: disableAction,
            thresholdReference: l10n.t('Threshold: multi-region writes enabled on a non-SQL API account'),
        };
    }

    // Single write region + the flag set = latent tripwire regardless of environment: no benefit today (write
    // failover needs a second region), and write cost doubles the moment a second write region is added.
    if (config.writeRegionCount < 2) {
        return {
            ...base,
            severity: 'Low',
            title: l10n.t('Multi-region writes with a single write region'),
            rationale: clampRationale(
                l10n.t(
                    'Multi-region writes are enabled but the account has a single write region, so the feature delivers no benefit today (RTO=0 write failover needs a second region), while write cost doubles the moment a second write region is added.',
                ),
            ),
            suggestedAction: l10n.t(
                'Disable multi-region writes to remove the tripwire unless a second write region is imminent and justified.',
            ),
            thresholdReference: l10n.t('Threshold: multi-region writes enabled with a single write region'),
        };
    }

    // Two or more write regions: legitimate active-active HA in production; only flagged in non-production.
    const env = classifyEnvironment(config.accountName, config.tags, config.subscriptionName);
    if (!env.isNonProd) {
        return undefined;
    }
    return {
        ...base,
        severity: 'Medium',
        title: l10n.t('Multi-region writes on a non-production account'),
        rationale: clampRationale(
            l10n.t(
                'Multi-region writes are enabled across {regions} write regions on a non-production account, which does not need RTO=0 write failover. This doubles write cost and adds write-conflict surface for no benefit.',
                { regions: config.writeRegionCount },
            ),
        ),
        suggestedAction: l10n.t(
            'Disable multi-region writes (and consider dropping the second write region) on dev/test/stage accounts.',
        ),
        thresholdReference: l10n.t('Threshold: multi-region writes across ≥ 2 write regions on a non-prod account'),
    };
}

export class MultiRegionWriteAntipatternDetector extends Detector {
    readonly rule = 'MultiRegionWriteAntipattern' as const;
    evaluate = evaluateMultiRegionWrites;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        if (!ctx.inputs.accountConfig) {
            return [];
        }
        const advisory = this.evaluate(ctx.inputs.accountConfig);
        return advisory ? [advisory] : [];
    }
}

export const multiRegionWriteAntipatternDetector = new MultiRegionWriteAntipatternDetector();
