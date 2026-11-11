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
import { type AccountConfigInput, type AdvisoryEvaluation, type DerivedAdvisory } from '../core/types';

/** Cosmos DB APIs whose drivers cannot use multi-region-write failover, so the flag is always a misconfiguration. */
const NON_MULTI_WRITE_APIS = new Map<
    NonNullable<AccountConfigInput['api']>,
    'cassandra' | 'gremlin' | 'table' | 'mongo'
>([
    [API.Cassandra, 'cassandra'],
    [API.Graph, 'gremlin'],
    [API.Table, 'table'],
    ['MongoDB', 'mongo'],
]);

/**
 * MultiRegionWriteAntipattern (CODA DX-008): multi-region writes are enabled where the RTO=0 write-failover
 * benefit cannot or need not apply. The wrong-API case (Cassandra/Gremlin/Table drivers cannot use the
 * failover) is highest confidence; a single write region with the flag set is a latent tripwire (no benefit today,
 * doubled write cost the moment a second write region is added); non-production with ≥ 2 write regions does not
 * need RTO=0 write failover. Two-or-more write regions in production is legitimate active-active HA and never
 * fires. Pure.
 */
function evaluateMultiRegionWrites(config: AccountConfigInput): AdvisoryEvaluation<'MultiRegionWriteAntipattern'> {
    if (!config.multiRegionWritesEnabled) {
        return { rootCause: 'not_multi_region_writes' };
    }

    const base = { id: 'MultiRegionWriteAntipattern', rule: 'MultiRegionWriteAntipattern' as const };
    const disableAction = l10n.t(
        'Review multi-region-write compatibility and availability requirements before changing the flag. Disabling multi-write while keeping all regions does not remove their provisioned capacity.',
    );

    // Wrong-API: the failover benefit is impossible regardless of environment — highest confidence.
    const apiCode = config.api === undefined ? undefined : NON_MULTI_WRITE_APIS.get(config.api);
    if (config.api !== undefined && apiCode !== undefined) {
        const apiLabel = config.api === 'MongoDB' ? 'MongoDB' : getExperienceFromApi(config.api).shortName;
        return {
            rootCause: `${apiCode}_multi_region_writes`,
            advisory: {
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
                            'Review the write-conflict and pricing implications against the current API and region configuration.',
                        ),
                ),
                suggestedAction: disableAction,
                thresholdReference: l10n.t('Threshold: multi-region writes enabled on a non-SQL API account'),
            },
        };
    }

    // Single write region + the flag set = latent tripwire regardless of environment: no benefit today (write
    // failover needs a second region), and write cost doubles the moment a second write region is added.
    if (config.writeRegionCount < DIAGNOSTIC_POLICY.multiRegionWrite.minWriteRegions) {
        return {
            rootCause: 'single_region_multi_region_writes_tripwire',
            advisory: {
                ...base,
                severity: 'Low',
                title: l10n.t('Multi-region writes with a single write region'),
                rationale: clampRationale(
                    l10n.t('Multi-region writes are enabled but the account has a single write region.') +
                        ' ' +
                        l10n.t('The feature delivers no benefit today (RTO=0 write failover needs a second region).') +
                        ' ' +
                        l10n.t(
                            'Adding write regions can increase cost and conflict complexity; no savings are quantified here.',
                        ),
                ),
                suggestedAction: l10n.t(
                    'Disable multi-region writes to remove the tripwire unless a second write region is imminent and justified.',
                ),
                thresholdReference: l10n.t('Threshold: multi-region writes enabled with a single write region'),
            },
        };
    }

    // Two or more write regions: legitimate active-active HA in production; only flagged in non-production.
    const env = classifyEnvironment(config.accountName, config.tags, config.subscriptionName);
    if (!env.isNonProd) {
        return { rootCause: 'legitimate_ha' };
    }
    return {
        rootCause: 'nonprod_multi_region_writes',
        advisory: {
            ...base,
            severity: 'Medium',
            title: l10n.t('Multi-region writes on a non-production account'),
            rationale: clampRationale(
                l10n.t(
                    'Multi-region writes are enabled across `{regions} write regions` on a non-production account, which does not need RTO=0 write failover.',
                    { regions: config.writeRegionCount },
                ) +
                    ' ' +
                    l10n.t(
                        'Confirm this inferred environment and its availability requirements with the account owner.',
                    ),
            ),
            suggestedAction: l10n.t(
                'Review disabling multi-region writes if active-active availability is unnecessary. Separately assess whether extra regions can be removed; toggling multi-write alone does not recover regional capacity.',
            ),
            thresholdReference: l10n.t(
                'Threshold: multi-region writes across ≥ `2 write regions` on a non-prod account',
            ),
        },
    };
}

function evaluateRegionalCapacity(
    config: AccountConfigInput,
    manualRu?: number,
): AdvisoryEvaluation<'MultiRegionWriteAntipattern'> {
    const result = evaluateMultiRegionWrites(config);
    if (
        config.isServerless !== false ||
        manualRu === undefined ||
        !Number.isFinite(manualRu) ||
        manualRu <= 0 ||
        !Number.isInteger(config.regionCount) ||
        config.regionCount < 1
    ) {
        return { ...result, observations: { regionalCapacityQuantified: false } };
    }
    const observations = {
        regionalCapacityQuantified: true as const,
        configuredPerRegionRu: manualRu,
        globalRegionalFootprintRu: manualRu * config.regionCount,
        removableExtraRegionRu:
            result.rootCause === 'nonprod_multi_region_writes' ? manualRu * (config.regionCount - 1) : null,
    };
    return {
        ...result,
        observations,
        advisory: result.advisory ? { ...result.advisory, evidence: observations } : undefined,
    };
}

export class MultiRegionWriteAntipatternDetector extends Detector {
    readonly rule = 'MultiRegionWriteAntipattern' as const;
    evaluateResult = evaluateRegionalCapacity;
    evaluate = (...args: Parameters<typeof evaluateRegionalCapacity>) => evaluateRegionalCapacity(...args).advisory;
    run(ctx: DetectorContext): DerivedAdvisory[] {
        if (!ctx.inputs.accountConfig) {
            return [];
        }
        const advisory = this.evaluate(ctx.inputs.accountConfig, ctx.inputs.manualRegionalCapacityRu);
        return advisory ? [advisory] : [];
    }
}

export const multiRegionWriteAntipatternDetector = new MultiRegionWriteAntipatternDetector();
