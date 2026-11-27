/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { API, getExperienceFromApi } from '../../../../../AzureDBExperiences';
import { classifyEnvironment } from '../../environmentClassifier';
import { Detector, type DetectorContext, type DetectorEvaluation } from '../core/Detector';
import { clampRationale } from '../core/helpers';
import { DIAGNOSTIC_POLICY } from '../core/thresholds';
import { type AccountConfigInput, type AdvisoryEvaluation } from '../core/types';

/** API families where configuration alone warrants checking client-side write failover. */
const CLIENT_FAILOVER_APIS = new Map<
    NonNullable<AccountConfigInput['api']>,
    'cassandra' | 'gremlin' | 'table' | 'mongo'
>([
    [API.Cassandra, 'cassandra'],
    [API.Graph, 'gremlin'],
    [API.Table, 'table'],
    ['MongoDB', 'mongo'],
]);

const MULTI_WRITE_REMEDIATION = 'global-multi-region-write-antipattern';

function clientFailoverCheck(api: 'cassandra' | 'gremlin' | 'table' | 'mongo'): string {
    switch (api) {
        case 'cassandra':
            return l10n.t("Check the driver's load-balancing policy and preferred regions.");
        case 'gremlin':
            return l10n.t('Check whether the client uses the global endpoint or selects regional endpoints.');
        case 'table':
            return l10n.t('Check regional routing and fallback in the Table SDK and version your application uses.');
        case 'mongo':
            return l10n.t('Check the preferred write region in your MongoDB connection settings.');
    }
}

/**
 * MultiRegionWriteAntipattern (CODA DX-008): ARM reveals write-region configuration, not application failover.
 * For Cassandra, Gremlin, Table and MongoDB, advise verifying the client. Otherwise check the single-region
 * tripwire and non-production use before treating the configuration as legitimate HA. Pure.
 */
function evaluateMultiRegionWrites(config: AccountConfigInput): AdvisoryEvaluation<'MultiRegionWriteAntipattern'> {
    if (!config.multiRegionWritesEnabled) {
        return { rootCause: 'not_multi_region_writes' };
    }

    const base = { id: 'MultiRegionWriteAntipattern', rule: 'MultiRegionWriteAntipattern' as const };
    const apiCode = config.api === undefined ? undefined : CLIENT_FAILOVER_APIS.get(config.api);
    if (config.api !== undefined && apiCode !== undefined) {
        const apiLabel = config.api === 'MongoDB' ? 'MongoDB' : getExperienceFromApi(config.api).shortName;
        return {
            rootCause: `${apiCode}_multi_region_writes`,
            observations: { regionalCapacityQuantified: false, clientWriteFailover: 'not_assessed' },
            advisory: {
                ...base,
                severity: 'Low',
                agentKitRule: null,
                title: l10n.t('Verify client write failover on a {api} account', { api: apiLabel }),
                rationale: clampRationale(
                    l10n.t('Multi-region writes are enabled on a {api} API account.', { api: apiLabel }) +
                        ' ' +
                        l10n.t(
                            'Account configuration does not show whether your application redirects writes when its usual write region is unavailable.',
                        ),
                ),
                suggestedAction:
                    l10n.t('Verify client write failover for your {api} application.', { api: apiLabel }) +
                    ' ' +
                    clientFailoverCheck(apiCode) +
                    ' ' +
                    l10n.t(
                        'Run a controlled test to check whether writes resume within your recovery target when the usual write region is unavailable.',
                    ),
                thresholdReference: l10n.t('Configuration: multi-region writes enabled on a {api} account', {
                    api: apiLabel,
                }),
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
                agentKitRule: MULTI_WRITE_REMEDIATION,
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
            agentKitRule: MULTI_WRITE_REMEDIATION,
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
    const clientWriteFailover = result.observations?.clientWriteFailover;
    const clientEvidence = clientWriteFailover ? { clientWriteFailover } : undefined;
    if (
        config.isServerless !== false ||
        manualRu === undefined ||
        !Number.isFinite(manualRu) ||
        manualRu <= 0 ||
        !Number.isInteger(config.regionCount) ||
        config.regionCount < 1
    ) {
        return {
            ...result,
            observations: { regionalCapacityQuantified: false, ...clientEvidence },
            advisory:
                result.advisory && clientEvidence ? { ...result.advisory, evidence: clientEvidence } : result.advisory,
        };
    }
    const observations = {
        regionalCapacityQuantified: true as const,
        ...clientEvidence,
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
    protected readonly notApplicableRootCauses = ['not_multi_region_writes'];
    evaluateResult = evaluateRegionalCapacity;
    evaluate = (...args: Parameters<typeof evaluateRegionalCapacity>) => evaluateRegionalCapacity(...args).advisory;
    protected evaluateInputs(ctx: DetectorContext): DetectorEvaluation[] {
        if (!ctx.inputs.accountConfig) {
            return [];
        }

        return [this.evaluateResult(ctx.inputs.accountConfig, ctx.inputs.manualRegionalCapacityRu)];
    }
}

export const multiRegionWriteAntipatternDetector = new MultiRegionWriteAntipatternDetector();
