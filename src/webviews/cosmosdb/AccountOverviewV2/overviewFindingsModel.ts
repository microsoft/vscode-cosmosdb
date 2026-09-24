/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type DerivedAdvisoryRule, type MetricKey, type UnavailableReason } from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

export type OverviewSummaryProps = {
    overview: AccountOverviewState;
    onInspect: (section: 'metrics' | 'inventory' | 'partition' | 'findings', metric?: MetricKey) => void;
};

export interface OverviewFinding {
    id: string;
    source: 'alert' | 'derived' | 'advisor';
    priority: number;
    severity: string;
    title: string;
    scope: string;
    rationale: string;
    action?: string;
    threshold?: string;
    benefit?: string;
    url?: string;
    recommendation: boolean;
}

const OPPORTUNITY_RULES: ReadonlySet<DerivedAdvisoryRule> = new Set([
    'OverProvisioning',
    'AutoscaleCandidate',
    'IdleContainer',
    'PartitionMergeCandidate',
    'AutoscaleMaxOverProvisioned',
    'AutoscaleToManualCandidate',
    'ServerlessCandidate',
]);

const SOURCE_ORDER = { alert: 0, derived: 1, advisor: 2 };
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Critical alerts precede Warning/High, Medium, then Informational/Low. Ties use source, scope and stable ID,
 * not translated text or arrival order. Only identical source+ID entries are deduplicated; similar evidence
 * from independent sources remains visible. Detector thresholds and detector suppression are unchanged.
 */
export function rankOverviewFindings(findings: readonly OverviewFinding[]): OverviewFinding[] {
    const sorted = [...findings].sort(
        (a, b) =>
            a.priority - b.priority ||
            SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
            compareText(a.scope, b.scope) ||
            compareText(a.id, b.id) ||
            compareText(a.title, b.title),
    );
    const seen = new Set<string>();
    return sorted.filter((finding) => {
        const key = JSON.stringify([finding.source, finding.id]);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function impactLabel(impact: 'High' | 'Medium' | 'Low'): string {
    return impact === 'High' ? l10n.t('High') : impact === 'Medium' ? l10n.t('Medium') : l10n.t('Low');
}

export function collectOverviewFindings(
    overview: Pick<
        OverviewSummaryProps['overview'],
        'alerts' | 'alertTimeRange' | 'derivedAdvisories' | 'recommendations' | 'dismissedAdvisoryIds'
    >,
): OverviewFinding[] {
    const findings: OverviewFinding[] = [];
    if (overview.alerts?.available && overview.alerts.timeRange === overview.alertTimeRange) {
        for (const alert of overview.alerts.alerts) {
            findings.push({
                id: alert.id,
                source: 'alert',
                priority: { Critical: 0, Warning: 1, Informational: 3 }[alert.severity],
                severity:
                    alert.severity === 'Critical'
                        ? l10n.t('Critical')
                        : alert.severity === 'Warning'
                          ? l10n.t('Warning')
                          : l10n.t('Informational'),
                title: alert.name,
                scope: alert.targetResource ?? l10n.t('Account-wide'),
                rationale: alert.alertRule
                    ? l10n.t('Fired Azure Monitor rule: {rule}', { rule: alert.alertRule })
                    : l10n.t('Azure Monitor reports an active alert. Inspect the alert for its rule and evidence.'),
                url: alert.portalUrl,
                recommendation: false,
            });
        }
    }
    if (overview.derivedAdvisories?.available) {
        for (const advisory of overview.derivedAdvisories.advisories) {
            if (overview.dismissedAdvisoryIds.has(advisory.id)) {
                continue;
            }
            findings.push({
                id: advisory.id,
                source: 'derived',
                priority: { High: 1, Medium: 2, Low: 3 }[advisory.severity],
                severity: impactLabel(advisory.severity),
                title: advisory.title,
                scope: advisory.scope ?? l10n.t('Account-wide'),
                rationale: advisory.rationale,
                action: advisory.suggestedAction,
                threshold: advisory.thresholdReference,
                recommendation: OPPORTUNITY_RULES.has(advisory.rule),
            });
        }
    }
    if (overview.recommendations?.available) {
        for (const recommendation of overview.recommendations.recommendations) {
            findings.push({
                id: recommendation.id,
                source: 'advisor',
                priority: { High: 1, Medium: 2, Low: 3 }[recommendation.impact],
                severity: l10n.t('{impact} impact', { impact: impactLabel(recommendation.impact) }),
                title: recommendation.problem,
                scope: l10n.t('Account-associated; detailed resource scope is not provided'),
                rationale: l10n.t('Azure Advisor category: {category}', { category: recommendation.category }),
                action: recommendation.solution,
                benefit: recommendation.potentialBenefit,
                url: recommendation.learnMoreLink,
                recommendation: true,
            });
        }
    }
    return rankOverviewFindings(findings);
}

export function unavailableSummary(reason?: UnavailableReason): string {
    switch (reason) {
        case 'rbac':
            return l10n.t('Unavailable: the signed-in identity does not have permission to read this source.');
        case 'unsupported':
            return l10n.t('Unavailable for this API or capacity mode.');
        case 'logAnalyticsDisabled':
            return l10n.t('Diagnostic settings are not exporting logs to a Log Analytics workspace.');
        case 'noData':
            return l10n.t('No usable data returned. The source may be idle, delayed, or temporarily unavailable.');
        default:
            return l10n.t('Data unavailable; the source did not provide a reason.');
    }
}

export function findingSourceLabel(source: OverviewFinding['source']): string {
    return source === 'alert'
        ? l10n.t('Azure Monitor alert')
        : source === 'advisor'
          ? l10n.t('Azure Advisor')
          : l10n.t('Derived finding');
}
