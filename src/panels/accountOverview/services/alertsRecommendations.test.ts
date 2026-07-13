/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AdvisorManagementClient, type ResourceRecommendationBase } from '@azure/arm-advisor';
import { type Alert, type AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    __resetAdvisorCache,
    buildAlertPortalUrl,
    compareAlerts,
    compareRecommendations,
    escalateAccountHealth,
    getActiveAlerts,
    getRecommendations,
    isHighImpactPerfCost,
    mapAlertSeverity,
    normalizeImpact,
    type AlertItem,
    type RecommendationItem,
} from './alertsRecommendations';

function asyncIterable<T>(items: T[]): AsyncIterableIterator<T> {
    return (async function* () {
        for (const item of items) {
            yield item;
        }
    })();
}

function makeAlert(id: string, severity: string, essentials: Record<string, unknown> = {}): Alert {
    return {
        id,
        name: id,
        properties: {
            essentials: {
                severity,
                monitorCondition: 'Fired',
                alertState: 'New',
                ...essentials,
            },
        },
    } as unknown as Alert;
}

function mockAlertsClient(alerts: Alert[], fail = false): AlertsManagementClient {
    return {
        alerts: {
            getAll: () => {
                if (fail) {
                    throw new Error('alerts boom');
                }
                return asyncIterable(alerts);
            },
        },
    } as unknown as AlertsManagementClient;
}

function makeRec(
    resourceId: string,
    impact: string,
    category: string,
    problem = 'problem',
): ResourceRecommendationBase {
    return {
        id: `${resourceId}|${category}|${impact}`,
        category,
        impact,
        shortDescription: { problem, solution: 'solution' },
        resourceMetadata: { resourceId },
    } as unknown as ResourceRecommendationBase;
}

function mockAdvisorClient(
    recs: ResourceRecommendationBase[],
    fail = false,
): { client: AdvisorManagementClient; calls: () => number } {
    let calls = 0;
    const client = {
        recommendations: {
            list: () => {
                calls++;
                if (fail) {
                    throw new Error('advisor boom');
                }
                return asyncIterable(recs);
            },
        },
    } as unknown as AdvisorManagementClient;
    return { client, calls: () => calls };
}

describe('mapAlertSeverity', () => {
    it('buckets Sev0/Sev1 as Critical', () => {
        expect(mapAlertSeverity('Sev0')).toBe('Critical');
        expect(mapAlertSeverity('Sev1')).toBe('Critical');
    });

    it('buckets Sev2/Sev3 as Warning', () => {
        expect(mapAlertSeverity('Sev2')).toBe('Warning');
        expect(mapAlertSeverity('Sev3')).toBe('Warning');
    });

    it('buckets Sev4 and unknown as Informational', () => {
        expect(mapAlertSeverity('Sev4')).toBe('Informational');
        expect(mapAlertSeverity(undefined)).toBe('Informational');
    });
});

describe('buildAlertPortalUrl', () => {
    it('builds an AlertDetails blade deep link with an encoded id', () => {
        const id = '/subscriptions/s/providers/Microsoft.AlertsManagement/alerts/abc';
        const url = buildAlertPortalUrl(id);
        expect(url).toContain('AlertDetailsTemplateBlade/alertId/');
        expect(url).toContain(encodeURIComponent(id));
    });
});

describe('compareAlerts', () => {
    const base: AlertItem = {
        id: 'x',
        name: 'x',
        severity: 'Warning',
        rawSeverity: 'Sev2',
        startedAt: 100,
        portalUrl: '',
    };

    it('orders Critical before Warning before Informational', () => {
        const crit = { ...base, severity: 'Critical' as const };
        const info = { ...base, severity: 'Informational' as const };
        const sorted = [info, crit, base].sort(compareAlerts);
        expect(sorted.map((a) => a.severity)).toEqual(['Critical', 'Warning', 'Informational']);
    });

    it('orders newer alerts first within the same severity', () => {
        const older = { ...base, startedAt: 100 };
        const newer = { ...base, startedAt: 200 };
        expect([older, newer].sort(compareAlerts)[0]).toBe(newer);
    });
});

describe('normalizeImpact', () => {
    it('passes through known impacts and defaults unknowns to Low', () => {
        expect(normalizeImpact('High')).toBe('High');
        expect(normalizeImpact('Medium')).toBe('Medium');
        expect(normalizeImpact('Low')).toBe('Low');
        expect(normalizeImpact('Bogus')).toBe('Low');
        expect(normalizeImpact(undefined)).toBe('Low');
    });
});

describe('compareRecommendations', () => {
    const mk = (impact: 'High' | 'Medium' | 'Low', category: string): RecommendationItem => ({
        id: `${impact}-${category}`,
        category,
        impact,
        problem: 'p',
    });

    it('orders High before Medium before Low, then by category', () => {
        const sorted = [mk('Low', 'Cost'), mk('High', 'Performance'), mk('High', 'Cost'), mk('Medium', 'Cost')].sort(
            compareRecommendations,
        );
        expect(sorted.map((r) => `${r.impact}/${r.category}`)).toEqual([
            'High/Cost',
            'High/Performance',
            'Medium/Cost',
            'Low/Cost',
        ]);
    });
});

describe('isHighImpactPerfCost', () => {
    it('is true only for High-impact Performance or Cost recommendations', () => {
        expect(isHighImpactPerfCost({ impact: 'High', category: 'Performance' })).toBe(true);
        expect(isHighImpactPerfCost({ impact: 'High', category: 'Cost' })).toBe(true);
        expect(isHighImpactPerfCost({ impact: 'High', category: 'Security' })).toBe(false);
        expect(isHighImpactPerfCost({ impact: 'Medium', category: 'Cost' })).toBe(false);
    });
});

describe('escalateAccountHealth', () => {
    it('escalates to Critical on a Sev0/Sev1 alert', () => {
        expect(
            escalateAccountHealth('Healthy', {
                hasCriticalAlert: true,
                hasWarningAlert: false,
                hasHighImpactPerfCostRec: false,
            }),
        ).toBe('Critical');
    });

    it('escalates to Needs Attention on a Sev2/Sev3 alert or a High-impact Perf/Cost rec', () => {
        expect(
            escalateAccountHealth('Healthy', {
                hasCriticalAlert: false,
                hasWarningAlert: true,
                hasHighImpactPerfCostRec: false,
            }),
        ).toBe('Needs Attention');
        expect(
            escalateAccountHealth('Healthy', {
                hasCriticalAlert: false,
                hasWarningAlert: false,
                hasHighImpactPerfCostRec: true,
            }),
        ).toBe('Needs Attention');
    });

    it('never downgrades the base health', () => {
        expect(
            escalateAccountHealth('Critical', {
                hasCriticalAlert: false,
                hasWarningAlert: false,
                hasHighImpactPerfCostRec: false,
            }),
        ).toBe('Critical');
        expect(
            escalateAccountHealth('Needs Attention', {
                hasCriticalAlert: true,
                hasWarningAlert: false,
                hasHighImpactPerfCostRec: false,
            }),
        ).toBe('Critical');
    });
});

describe('getActiveAlerts', () => {
    it('maps severities, counts, and sorts, with per-alert portal links', async () => {
        const client = mockAlertsClient([
            makeAlert('/a/warn', 'Sev2', { startDateTime: new Date(1000) }),
            makeAlert('/a/crit', 'Sev1', { startDateTime: new Date(2000), alertRule: 'rule-x' }),
            makeAlert('/a/info', 'Sev4'),
        ]);

        const result = await getActiveAlerts(client, 'sub1', '/acct', '1d');

        expect(result.available).toBe(true);
        expect(result.criticalCount).toBe(1);
        expect(result.warningCount).toBe(1);
        expect(result.alerts.map((a) => a.severity)).toEqual(['Critical', 'Warning', 'Informational']);
        expect(result.alerts[0].portalUrl).toContain('AlertDetailsTemplateBlade');
        expect(result.alerts[0].startedAt).toBe(2000);
    });

    it('returns available: false when Alerts Management throws', async () => {
        const result = await getActiveAlerts(mockAlertsClient([], true), 'sub1', '/acct', '7d');
        expect(result.available).toBe(false);
        expect(result.alerts).toEqual([]);
    });

    it('returns available: true with no alerts when the scope is clean', async () => {
        const result = await getActiveAlerts(mockAlertsClient([]), 'sub1', '/acct', '30d');
        expect(result.available).toBe(true);
        expect(result.alerts).toEqual([]);
        expect(result.criticalCount).toBe(0);
    });
});

describe('getRecommendations', () => {
    const ACCOUNT = '/subscriptions/sub1/providers/Microsoft.DocumentDB/databaseAccounts/acct';
    const OTHER = '/subscriptions/sub1/providers/Microsoft.DocumentDB/databaseAccounts/other';

    beforeEach(() => {
        __resetAdvisorCache();
    });

    it('shards the subscription-wide list to the account and sorts by impact', async () => {
        const { client } = mockAdvisorClient([
            makeRec(ACCOUNT, 'Medium', 'Cost'),
            makeRec(ACCOUNT, 'High', 'Performance'),
            makeRec(OTHER, 'High', 'Cost'),
        ]);

        const result = await getRecommendations(client, 'sub1', ACCOUNT);

        expect(result.available).toBe(true);
        expect(result.recommendations).toHaveLength(2);
        expect(result.recommendations[0].impact).toBe('High');
        expect(result.hasHighImpactPerfCost).toBe(true);
    });

    it('reports hasHighImpactPerfCost: false when no qualifying rec exists', async () => {
        const { client } = mockAdvisorClient([makeRec(ACCOUNT, 'High', 'Security'), makeRec(ACCOUNT, 'Low', 'Cost')]);
        const result = await getRecommendations(client, 'sub1', ACCOUNT);
        expect(result.hasHighImpactPerfCost).toBe(false);
    });

    it('returns available: false when Advisor throws', async () => {
        const { client } = mockAdvisorClient([], true);
        const result = await getRecommendations(client, 'sub1', ACCOUNT);
        expect(result.available).toBe(false);
    });

    it('makes a single subscription-wide call shared across concurrent dashboards', async () => {
        const { client, calls } = mockAdvisorClient([makeRec(ACCOUNT, 'High', 'Performance')]);
        const now = Date.now();

        const [a, b] = await Promise.all([
            getRecommendations(client, 'sub1', ACCOUNT, now),
            getRecommendations(client, 'sub1', OTHER, now),
        ]);

        expect(calls()).toBe(1);
        expect(a.available).toBe(true);
        expect(b.available).toBe(true);
        expect(a.recommendations).toHaveLength(1);
        expect(b.recommendations).toHaveLength(0);
    });
});
