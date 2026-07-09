/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AdvisorManagementClient, type ResourceRecommendationBase } from '@azure/arm-advisor';
import { type AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { classifyUnavailable, type HealthState, type UnavailableReason } from './shared';

// ─── Alerts and Advisor recommendations ───────────────────────────────────────────
//
// The dashboard right-rail is server-authored: Active Alerts come from Azure
// Alerts Management (filtered to this account's resourceId) and Recommendations
// come from Azure Advisor. Advisor has no per-resource list endpoint, so we make
// one subscription-wide call and shard the results client-side by accountId —
// and share that single call across every dashboard open in the same
// subscription via a short-TTL cache. All ARM
// failures degrade to `available: false` so the webview renders an empty-state.

/** Normalized alert severity buckets (Sev0/1 → Critical, Sev2/3 → Warning, Sev4 → Informational). */
export type AlertSeverity = 'Critical' | 'Warning' | 'Informational';

/** Single source of truth for the Alerts Management time-range filter values, passed straight through to `alerts.getAll`. */
export const ALERT_TIME_RANGES = ['1h', '1d', '7d', '30d'] as const;

/** Alerts Management time-range filter values, derived from {@link ALERT_TIME_RANGES}. */
export type AlertTimeRange = (typeof ALERT_TIME_RANGES)[number];

export interface AlertItem {
    id: string;
    name: string;
    severity: AlertSeverity;
    /** Raw Azure severity ('Sev0'..'Sev4'), retained so the UI can de-emphasize Sev4. */
    rawSeverity: string;
    monitorCondition?: string;
    alertState?: string;
    alertRule?: string;
    targetResource?: string;
    /** Alert start time in epoch milliseconds. */
    startedAt?: number;
    /** Deep link to the alert's "AlertDetails" blade in the Azure portal. */
    portalUrl: string;
}

export interface AlertsResult {
    /** False when Alerts Management returned an error for this account/scope. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    alerts: AlertItem[];
    /** Count of Sev0/Sev1 alerts (drives the account health pill → Critical). */
    criticalCount: number;
    /** Count of Sev2/Sev3 alerts (drives the account health pill → Needs Attention). */
    warningCount: number;
    timeRange: AlertTimeRange;
    generatedAt: number;
}

export type RecommendationImpact = 'High' | 'Medium' | 'Low';

export interface RecommendationItem {
    id: string;
    category: string;
    impact: RecommendationImpact;
    /** One-line problem statement (`shortDescription.problem`). */
    problem: string;
    /** One-line suggested action (`shortDescription.solution`). */
    solution?: string;
    /** Optional "Potential benefit" footer derived from Advisor `extendedProperties`. */
    potentialBenefit?: string;
    learnMoreLink?: string;
}

export interface RecommendationsResult {
    /** False when Advisor returned an error for this subscription. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    recommendations: RecommendationItem[];
    /** True when a High-impact Performance/Cost rec is present (drives the health pill → Needs Attention). */
    hasHighImpactPerfCost: boolean;
    generatedAt: number;
}

/** Maps an Azure alert severity string to the dashboard's three-bucket vocabulary. Pure. */
export function mapAlertSeverity(raw: string | undefined): AlertSeverity {
    switch (raw) {
        case 'Sev0':
        case 'Sev1':
            return 'Critical';
        case 'Sev2':
        case 'Sev3':
            return 'Warning';
        default:
            return 'Informational';
    }
}

/** Builds the standard Azure portal deep link to a single alert's details blade. Pure. */
export function buildAlertPortalUrl(alertId: string, portalBaseUrl = 'https://portal.azure.com'): string {
    return `${portalBaseUrl}/#blade/Microsoft_Azure_Monitoring/AlertDetailsTemplateBlade/alertId/${encodeURIComponent(alertId)}`;
}

const ALERT_SEVERITY_ORDER: Record<AlertSeverity, number> = { Critical: 0, Warning: 1, Informational: 2 };

/** Sorts alerts by severity (Critical first) then most-recent start time. Pure. */
export function compareAlerts(a: AlertItem, b: AlertItem): number {
    const bySeverity = ALERT_SEVERITY_ORDER[a.severity] - ALERT_SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) {
        return bySeverity;
    }
    return (b.startedAt ?? 0) - (a.startedAt ?? 0);
}

/** Coerces an Advisor impact string to the known enum, defaulting unknowns to Low. Pure. */
export function normalizeImpact(raw: string | undefined): RecommendationImpact {
    return raw === 'High' || raw === 'Medium' || raw === 'Low' ? raw : 'Low';
}

const IMPACT_ORDER: Record<RecommendationImpact, number> = { High: 0, Medium: 1, Low: 2 };

/** Sorts recommendations by impact (High first) then category. Pure. */
export function compareRecommendations(a: RecommendationItem, b: RecommendationItem): number {
    const byImpact = IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
    if (byImpact !== 0) {
        return byImpact;
    }
    return a.category.localeCompare(b.category);
}

const PERF_COST_CATEGORIES = new Set(['Performance', 'Cost']);

/** True for a High-impact Performance/Cost recommendation (the health-pill signal). Pure. */
export function isHighImpactPerfCost(rec: Pick<RecommendationItem, 'impact' | 'category'>): boolean {
    return rec.impact === 'High' && PERF_COST_CATEGORIES.has(rec.category);
}

/** Signals folded into the account health pill's final formula. */
export interface AccountHealthSignals {
    /** A Sev0 or Sev1 alert is active. */
    hasCriticalAlert: boolean;
    /** A Sev2 or Sev3 alert is active. */
    hasWarningAlert: boolean;
    /** A High-impact Performance/Cost recommendation is present. */
    hasHighImpactPerfCostRec: boolean;
}

const HEALTH_ORDER: Record<HealthState, number> = { Healthy: 0, 'Needs Attention': 1, Critical: 2 };

function worstHealth(a: HealthState, b: HealthState): HealthState {
    return HEALTH_ORDER[a] >= HEALTH_ORDER[b] ? a : b;
}

/**
 * Upgrades the base health (provisioning + throttling) with the alert/recommendation
 * signals: Sev0/Sev1 → Critical; Sev2/Sev3 or a High-impact Perf/Cost rec → Needs Attention.
 * Never downgrades the base. Pure for testing.
 */
export function escalateAccountHealth(base: HealthState, signals: AccountHealthSignals): HealthState {
    let signalHealth: HealthState = 'Healthy';
    if (signals.hasCriticalAlert) {
        signalHealth = 'Critical';
    } else if (signals.hasWarningAlert || signals.hasHighImpactPerfCostRec) {
        signalHealth = 'Needs Attention';
    }
    return worstHealth(base, signalHealth);
}

function extractPotentialBenefit(props: Record<string, string> | undefined): string | undefined {
    if (!props) {
        return undefined;
    }
    const amount = props.annualSavingsAmount ?? props.savingsAmount;
    if (amount) {
        const currency = props.savingsCurrency ?? props.currency ?? '';
        return currency ? `${currency} ${amount}` : amount;
    }
    return undefined;
}

/**
 * Reads all active alerts for `resourceId` in the given time range. `Fired`
 * monitor-condition only (open alerts). Returns `available: false` on any error.
 */
export async function getActiveAlerts(
    client: AlertsManagementClient,
    subscriptionId: string,
    resourceId: string,
    timeRange: AlertTimeRange,
    portalBaseUrl?: string,
): Promise<AlertsResult> {
    const generatedAt = Date.now();
    const scope = `/subscriptions/${subscriptionId}`;
    const alerts: AlertItem[] = [];

    try {
        for await (const alert of client.alerts.getAll(scope, {
            targetResource: resourceId,
            timeRange,
            monitorCondition: 'Fired',
        })) {
            const essentials = alert.properties?.essentials;
            const id = alert.id ?? '';
            alerts.push({
                id,
                name: alert.name ?? id,
                severity: mapAlertSeverity(essentials?.severity),
                rawSeverity: essentials?.severity ?? '',
                monitorCondition: essentials?.monitorCondition,
                alertState: essentials?.alertState,
                alertRule: essentials?.alertRule,
                targetResource: essentials?.targetResource,
                startedAt: essentials?.startDateTime ? new Date(essentials.startDateTime).getTime() : undefined,
                portalUrl: buildAlertPortalUrl(id, portalBaseUrl),
            });
        }
    } catch (error) {
        return {
            available: false,
            reason: classifyUnavailable(error),
            alerts: [],
            criticalCount: 0,
            warningCount: 0,
            timeRange,
            generatedAt,
        };
    }

    alerts.sort(compareAlerts);
    const criticalCount = alerts.filter((a) => a.severity === 'Critical').length;
    const warningCount = alerts.filter((a) => a.severity === 'Warning').length;
    return { available: true, alerts, criticalCount, warningCount, timeRange, generatedAt };
}

interface AdvisorCacheEntry {
    at: number;
    promise: Promise<ResourceRecommendationBase[]>;
}

/** How long a subscription-wide Advisor result is reused; just under the 60 s poll cadence. */
export const ADVISOR_CACHE_TTL_MS = 55_000;

const advisorCache = new Map<string, AdvisorCacheEntry>();

/** Test-only helper to clear the subscription-wide Advisor batch cache between cases. */
export function __resetAdvisorCache(): void {
    advisorCache.clear();
}

/**
 * One subscription-wide Advisor `recommendations.list()` per subscription per
 * TTL window, shared across every open dashboard in that subscription. Concurrent
 * callers await the same in-flight promise; a rejected promise is evicted so the
 * next caller retries.
 */
async function listSubscriptionRecommendations(
    client: AdvisorManagementClient,
    subscriptionId: string,
    now: number,
): Promise<ResourceRecommendationBase[]> {
    const cached = advisorCache.get(subscriptionId);
    if (cached && now - cached.at < ADVISOR_CACHE_TTL_MS) {
        return cached.promise;
    }

    const promise = (async () => {
        const items: ResourceRecommendationBase[] = [];
        for await (const rec of client.recommendations.list()) {
            items.push(rec);
        }
        return items;
    })();

    advisorCache.set(subscriptionId, { at: now, promise });
    promise.catch(() => {
        if (advisorCache.get(subscriptionId)?.promise === promise) {
            advisorCache.delete(subscriptionId);
        }
    });
    return promise;
}

/**
 * Advisor recommendations for a single account, sharded from the shared
 * subscription-wide call by `accountId`. Returns `available: false` on any error.
 */
export async function getRecommendations(
    client: AdvisorManagementClient,
    subscriptionId: string,
    accountId: string,
    now: number = Date.now(),
): Promise<RecommendationsResult> {
    const generatedAt = now;
    let all: ResourceRecommendationBase[];
    try {
        all = await listSubscriptionRecommendations(client, subscriptionId, now);
    } catch (error) {
        return {
            available: false,
            reason: classifyUnavailable(error),
            recommendations: [],
            hasHighImpactPerfCost: false,
            generatedAt,
        };
    }

    const target = accountId.toLowerCase();
    const recommendations: RecommendationItem[] = [];
    for (const rec of all) {
        const resourceId = (rec.resourceMetadata?.resourceId ?? rec.impactedValue ?? '').toLowerCase();
        if (resourceId !== target && !resourceId.startsWith(`${target}/`)) {
            continue;
        }
        const problem = rec.shortDescription?.problem ?? rec.description ?? rec.label ?? '';
        if (!problem) {
            continue;
        }
        recommendations.push({
            id: rec.id ?? rec.recommendationTypeId ?? problem,
            category: rec.category ?? 'Uncategorized',
            impact: normalizeImpact(rec.impact),
            problem,
            solution: rec.shortDescription?.solution,
            potentialBenefit: extractPotentialBenefit(rec.extendedProperties),
            learnMoreLink: rec.learnMoreLink,
        });
    }

    recommendations.sort(compareRecommendations);
    return {
        available: true,
        recommendations,
        hasHighImpactPerfCost: recommendations.some(isHighImpactPerfCost),
        generatedAt,
    };
}
