/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { API, getExperienceFromApi } from '../../../../../AzureDBExperiences';
import { classifyEnvironment } from '../../environmentClassifier';
import { Detector, type DetectorContext } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AccountConfigInput, type DerivedAdvisory } from '../core/types';

/** Cosmos DB APIs whose drivers cannot use multi-region-write failover, so the flag is always a misconfiguration. */
const NON_MULTI_WRITE_APIS: ReadonlySet<API> = new Set([API.Cassandra, API.Graph, API.Table]);

/**
 * MultiRegionWriteAntipattern (CODA DX-008): multi-region writes are enabled where the RTO=0 write-failover
 * benefit cannot or need not apply. The wrong-API case (Cassandra/Gremlin/Table drivers cannot use the
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
    if (config.api !== undefined && NON_MULTI_WRITE_APIS.has(config.api)) {
        const apiLabel = getExperienceFromApi(config.api).shortName;
        return {
            ...base,
            severity: 'High',
            title: l10n.t('Multi-region writes on a {api} account', { api: apiLabel }),
            rationale: clampRationale(
                l10n.t('Multi-region writes are enabled on a {api} API account.', { api: apiLabel }) +
                    ' ' +
                    l10n.t(
                        "The {api} drivers cannot use Cosmos DB's multi-region-write failover, so the RTO=0 HA benefit never materialises.",
                        {
                            api: apiLabel,
                        },
                    ) +
                    ' ' +
                    l10n.t(
                        'The account still carries the write-conflict surface (and 2× write cost across any second write region).',
                    ),
            ),
            suggestedAction: disableAction,
            thresholdReference: l10n.t('Threshold: multi-region writes enabled on a non-SQL API account'),
        };
    }

    // Single write region + the flag set = latent tripwire regardless of environment: no benefit today (write
    // failover needs a second region), and write cost doubles the moment a second write region is added.
    if (config.writeRegionCount < DIAGNOSTIC_POLICY.multiRegionWrite.minWriteRegions) {
        return {
            ...base,
            severity: 'Low',
            title: l10n.t('Multi-region writes with a single write region'),
            rationale: clampRationale(
                l10n.t('Multi-region writes are enabled but the account has a single write region.') +
                    ' ' +
                    l10n.t('The feature delivers no benefit today (RTO=0 write failover needs a second region).') +
                    ' ' +
                    l10n.t('Write cost doubles the moment a second write region is added.'),
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
                'Multi-region writes are enabled across {regions} write regions on a non-production account, which does not need RTO=0 write failover.',
                { regions: config.writeRegionCount },
            ) +
                ' ' +
                l10n.t('This doubles write cost and adds write-conflict surface for no benefit.'),
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
