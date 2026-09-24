/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type DerivedAdvisoryRule, type MetricKey, type UnavailableReason } from '../../api/types';
import { ruleMeta } from '../AccountOverview/derivedAdvisoryRuleMeta';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

export type OverviewSummaryProps = {
    overview: AccountOverviewState;
    onInspect: (
        section: 'metrics' | 'inventory' | 'partition' | 'findings' | 'recommendations' | 'throttling' | 'capacity',
        metric?: MetricKey,
    ) => void;
};

export interface OverviewFinding {
    id: string;
    source: 'alert' | 'derived' | 'advisor';
    /** Machine identity for grouping; absent on older fixtures and non-derived sources. */
    rule?: DerivedAdvisoryRule;
    alertRule?: string;
    priority: number;
    severity: string;
    title: string;
    scope: string;
    /** Preview-only scope text; the full finding's scope and evidence are not aggregates. */
    summaryScope?: string;
    rationale: string;
    action?: string;
    threshold?: string;
    benefit?: string;
    /** Qualitative potential benefit, not a measured or guaranteed improvement. */
    estimatedImpact?: string;
    url?: string;
    recommendation: boolean;
}

export type FindingSection = 'findings' | 'recommendations';

/** Preview semantics and potential benefits follow each detector's evidence and suggested action. */
export const derivedFindingPresentation = {
    HotPartitionRisk: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce hot-partition throttling'),
    },
    SustainedThrottlingInRegion: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce capacity-related throttling'),
    },
    OverProvisioning: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May reduce unused throughput costs'),
    },
    AutoscaleCandidate: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May better match capacity to bursts'),
    },
    StorageGrowthRisk: {
        section: 'findings',
        estimatedImpact: l10n.t('May relieve partition storage pressure'),
    },
    StorageSkewRisk: {
        section: 'findings',
        estimatedImpact: l10n.t('May improve storage distribution'),
    },
    IndexingCostRisk: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce write RU and index storage'),
    },
    ExpensiveConsistency: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce read RU costs if consistency needs allow'),
    },
    MultiRegionWriteAntipattern: {
        section: 'findings',
        estimatedImpact: l10n.t('May avoid unnecessary multi-region write costs'),
    },
    IdleContainer: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May avoid costs for unused resources'),
    },
    PartitionMergeCandidate: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May consolidate throughput onto fewer partitions'),
    },
    AutoscaleMaxOverProvisioned: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May lower the autoscale idle floor'),
    },
    AutoscaleToManualCandidate: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May reduce throughput costs for steady demand'),
    },
    ServerlessCandidate: {
        section: 'recommendations',
        estimatedImpact: l10n.t('May reduce costs for intermittent demand'),
    },
    CrossPartitionQuery: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce query RU and latency'),
    },
    ShardKeyMisalignment: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce query fan-out after re-keying'),
    },
    UncontrolledIngestion: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce ingestion-driven throttling'),
    },
    SharedThroughputStarvation: {
        section: 'findings',
        estimatedImpact: l10n.t('May reduce contention for shared throughput'),
    },
} satisfies Record<DerivedAdvisoryRule, { section: FindingSection; estimatedImpact?: string }>;

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

/**
 * Groups health findings only; callers apply the preview limit after grouping. The full collection stays untouched.
 * Group IDs are presentation keys, not dismissal IDs; dismiss individual findings before calling this function.
 * Derived coverage is not part of the backend contract (partition scans are capped at ten containers), so multiple
 * observed scopes never imply an exact affected total. Alert scopes come from the complete active-alert snapshot.
 */
export function groupOverviewHealthFindings(findings: readonly OverviewFinding[]): OverviewFinding[] {
    const groups = new Map<string, OverviewFinding[]>();
    for (const finding of rankOverviewFindings(findings.filter((item) => !item.recommendation))) {
        const key = JSON.stringify(
            finding.source === 'derived' && finding.rule
                ? [finding.source, 'rule', finding.rule]
                : finding.source === 'alert' && finding.alertRule
                  ? [finding.source, 'rule', finding.alertRule]
                  : [finding.source, 'id', finding.id],
        );
        const members = groups.get(key);
        if (members) {
            members.push(finding);
        } else {
            groups.set(key, [finding]);
        }
    }

    const summaries: OverviewFinding[] = [];
    for (const [key, members] of groups) {
        // Members are ranked already: the worst severity supplies the representative, regardless of arrival order.
        const representative = members[0];
        const scopes = [...new Set(members.map((member) => member.scope))].sort(compareText);
        const firstScope = scopes[0];
        const summaryScope =
            scopes.length === 1
                ? firstScope
                : representative.source === 'derived'
                  ? l10n.t('{scope} + others', { scope: firstScope })
                  : `${firstScope} +${scopes.length - 1}`;
        const meta =
            representative.source === 'derived' && representative.rule ? ruleMeta(representative.rule) : undefined;
        summaries.push({
            ...representative,
            id: meta || (representative.source === 'alert' && representative.alertRule) ? key : representative.id,
            summaryScope,
            estimatedImpact:
                representative.source === 'derived' && representative.rule
                    ? derivedFindingPresentation[representative.rule].estimatedImpact
                    : undefined,
            ...(meta
                ? {
                      title: meta.name,
                      rationale: meta.description,
                      action: undefined,
                      threshold: undefined,
                      benefit: undefined,
                      url: undefined,
                  }
                : {}),
        });
    }
    return rankOverviewFindings(summaries);
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
                alertRule: alert.alertRule,
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
                rule: advisory.rule,
                priority: { High: 1, Medium: 2, Low: 3 }[advisory.severity],
                severity: impactLabel(advisory.severity),
                title: advisory.title,
                scope: advisory.scope ?? l10n.t('Account-wide'),
                rationale: advisory.rationale,
                action: advisory.suggestedAction,
                threshold: advisory.thresholdReference,
                estimatedImpact: derivedFindingPresentation[advisory.rule].estimatedImpact,
                recommendation: derivedFindingPresentation[advisory.rule].section === 'recommendations',
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

export function overviewCategoryState(overview: OverviewSummaryProps['overview'], section: FindingSection) {
    const health = section === 'findings';
    const findings = collectOverviewFindings(overview).filter((finding) => finding.recommendation !== health);
    const loading = overview.derivedLoading || (health ? overview.alertsLoading : overview.recommendationsLoading);
    const partial =
        !overview.derivedAdvisories?.available ||
        (health
            ? overview.derivedAdvisories.logSource?.available === false ||
              !overview.alerts?.available ||
              overview.alerts.timeRange !== overview.alertTimeRange
            : !overview.recommendations?.available);
    const dismissedCount = new Set(
        overview.derivedAdvisories?.advisories
            .filter(
                (advisory) =>
                    overview.dismissedAdvisoryIds.has(advisory.id) &&
                    derivedFindingPresentation[advisory.rule].section === section,
            )
            .map((advisory) => advisory.id),
    ).size;
    const title = health ? l10n.t('Account health') : l10n.t('Prioritized recommendations');
    const empty = loading
        ? health
            ? l10n.t('Loading health findings…')
            : l10n.t('Loading recommendations…')
        : partial
          ? health
              ? l10n.t('No health findings to show; some sources are unavailable or have not loaded.')
              : l10n.t('No recommendations to show; some sources are unavailable or have not loaded.')
          : health
            ? l10n.t('No active health findings reported by available checks. Dismissed findings are not shown.')
            : l10n.t(
                  'No recommendations from available derived checks or Azure Advisor. Dismissed findings are not shown.',
              );
    return { findings, loading, partial, dismissedCount, title, empty };
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
