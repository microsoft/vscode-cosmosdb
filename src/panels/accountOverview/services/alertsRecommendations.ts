/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AdvisorManagementClient, type ResourceRecommendationBase } from '@azure/arm-advisor';
import { type AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    createDefaultHttpClient,
    createHttpHeaders,
    createPipelineRequest,
    RestError,
} from '@azure/core-rest-pipeline';
import { z } from 'zod';
import { classifyUnavailable, type UnavailableReason } from './shared';

export { escalateAccountHealth, type AccountHealthSignals } from '../overviewHealthModel';

// ─── Alerts and Advisor recommendations ───────────────────────────────────────────
//
// The dashboard right-rail is server-authored: Alerts come from Azure
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

export const ALERT_MONITOR_CONDITIONS = ['Fired', 'Resolved'] as const;
export type AlertMonitorCondition = (typeof ALERT_MONITOR_CONDITIONS)[number];

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
    /** Deep link to the alert's details view in the Azure portal. */
    portalUrl: string;
}

export interface AlertsResult {
    /** False when Alerts Management returned an error for this account/scope. */
    available: boolean;
    /** When `available` is false, why: `noData` | `unsupported` | `rbac`. */
    reason?: UnavailableReason;
    alerts: AlertItem[];
    /** Count of Sev0/Sev1 alerts in this result. Only Fired results may drive account health. */
    criticalCount: number;
    /** Count of Sev2/Sev3 alerts in this result. Only Fired results may drive account health. */
    warningCount: number;
    timeRange: AlertTimeRange;
    monitorCondition: AlertMonitorCondition;
    generatedAt: number;
}

export interface ActiveAlertSummary {
    available: boolean;
    reason?: UnavailableReason;
    totalCount: number;
    criticalCount: number;
    warningCount: number;
    generatedAt: number;
}

const alertCountsSchema = z.object({
    count: z.literal(1),
    totalRecords: z.literal(1),
    resultTruncated: z.union([z.literal(false), z.literal('false')]),
    $skipToken: z.undefined().optional(),
    data: z.tuple([
        z.object({
            totalCount: z.number().int().nonnegative(),
            criticalCount: z.number().int().nonnegative(),
            warningCount: z.number().int().nonnegative(),
        }),
    ]),
});

/** Counts all retained Fired alerts in Resource Graph, independently of the displayed list's time filter. */
export async function getActiveAlertSummary(
    client: CosmosDBManagementClient | undefined,
    subscriptionId: string,
    resourceId: string,
    resourceManagerEndpoint: string,
): Promise<ActiveAlertSummary> {
    const generatedAt = Date.now();
    const unavailable = (reason: UnavailableReason): ActiveAlertSummary => ({
        available: false,
        reason,
        totalCount: 0,
        criticalCount: 0,
        warningCount: 0,
        generatedAt,
    });
    if (!client) {
        return unavailable('noData');
    }
    try {
        // Reuse the authenticated ARM pipeline, including sovereign-cloud authentication and retries.
        const response = await client.pipeline.sendRequest(
            createDefaultHttpClient(),
            createPipelineRequest({
                url: `${resourceManagerEndpoint.replace(/\/+$/, '')}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`,
                method: 'POST',
                headers: createHttpHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    subscriptions: [subscriptionId],
                    query: `alertsmanagementresources
| where type =~ 'microsoft.alertsmanagement/alerts'
| where tostring(properties.essentials.targetResource) =~ ${JSON.stringify(resourceId)}
| where tostring(properties.essentials.monitorCondition) =~ 'Fired'
| summarize totalCount=count(), criticalCount=countif(tostring(properties.essentials.severity) in~ ('Sev0', 'Sev1')), warningCount=countif(tostring(properties.essentials.severity) in~ ('Sev2', 'Sev3'))`,
                    options: { resultFormat: 'objectArray', allowPartialScopes: false },
                }),
            }),
        );
        if (response.status < 200 || response.status >= 300) {
            throw new RestError('Unable to query active alerts in Resource Graph.', { statusCode: response.status });
        }
        const result = alertCountsSchema.parse(JSON.parse(response.bodyAsText ?? 'null'));
        const counts = result.data[0];
        if (counts.criticalCount + counts.warningCount > counts.totalCount) {
            throw new Error('Invalid active alert counts returned by Resource Graph.');
        }
        return { available: true, ...counts, generatedAt };
    } catch (error) {
        return unavailable(classifyUnavailable(error));
    }
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

/** Links directly to the current alert details view, avoiding the legacy blade redirect. Pure. */
export function buildAlertPortalUrl(
    alertId: string,
    portalBaseUrl = 'https://portal.azure.com',
    tenantId?: string,
): string {
    const tenant = tenantId ? `@${encodeURIComponent(tenantId)}/` : '';
    // Double-encode the route parameter so Uri.parse and the external opener do not expose its slashes as separators.
    const encodedAlertId = encodeURIComponent(encodeURIComponent(alertId));
    return `${portalBaseUrl.replace(/\/$/, '')}/#${tenant}view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId/${encodedAlertId}/invokedFrom/CopyLinkFeature`;
}

/** Opens the resource-scoped Alerts page used by the Cosmos DB portal's Monitoring summary. */
export function buildAccountAlertsPortalUrl(portalBaseUrl: string, tenantId: string, resourceId: string): string {
    const encodedResourceId = encodeURIComponent(encodeURIComponent(resourceId));
    return `${portalBaseUrl.replace(/\/$/, '')}/#@${encodeURIComponent(tenantId)}/blade/Microsoft_Azure_Monitoring_Alerts/AlertsSummaryBlade/resourceId/${encodedResourceId}`;
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
 * Reads alerts for `resourceId` in the given time range and monitor condition.
 * Incident workflow (`alertState`) is deliberately not filtered or modified.
 * Returns `available: false` on any error.
 */
export async function getAlerts(
    client: AlertsManagementClient,
    subscriptionId: string,
    resourceId: string,
    timeRange: AlertTimeRange,
    monitorCondition: AlertMonitorCondition,
    portalBaseUrl?: string,
    tenantId?: string,
): Promise<AlertsResult> {
    const generatedAt = Date.now();
    const scope = `/subscriptions/${subscriptionId}`;
    const alerts: AlertItem[] = [];

    try {
        for await (const alert of client.alerts.getAll(scope, {
            targetResource: resourceId,
            timeRange,
            monitorCondition,
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
                portalUrl: buildAlertPortalUrl(id, portalBaseUrl, tenantId),
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
            monitorCondition,
            generatedAt,
        };
    }

    alerts.sort(compareAlerts);
    const criticalCount = alerts.filter((a) => a.severity === 'Critical').length;
    const warningCount = alerts.filter((a) => a.severity === 'Warning').length;
    return { available: true, alerts, criticalCount, warningCount, timeRange, monitorCondition, generatedAt };
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
