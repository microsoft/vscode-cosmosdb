/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AdvisorManagementClient, type ResourceRecommendationBase } from '@azure/arm-advisor';
import { type Alert, AlertsManagementClient } from '@azure/arm-alertsmanagement';
import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ALERT_MONITOR_CONDITIONS,
    ALERT_TIME_RANGES,
    __resetAdvisorCache,
    buildAlertPortalUrl,
    buildAccountAlertsPortalUrl,
    compareAlerts,
    compareRecommendations,
    escalateAccountHealth,
    getAlerts,
    getActiveAlertSummary,
    getRecommendations,
    isHighImpactPerfCost,
    mapAlertSeverity,
    normalizeImpact,
    type AlertItem,
    type RecommendationItem,
} from './alertsRecommendations';
import { pagedItems } from './testFixtures';

describe('Resource Graph active alert summary', () => {
    const accountId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
    const counts = { totalCount: 9, criticalCount: 2, warningCount: 3 };
    const complete = { count: 1, totalRecords: 1, resultTruncated: 'false', data: [counts] };

    function graphClient(body: unknown = complete, status = 200) {
        const client = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
        const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
            request,
            status,
            headers: createHttpHeaders(),
            bodyAsText: JSON.stringify(body),
        }));
        return { client, send };
    }

    it('aggregates only Fired by account and severity without time filtering or enumerating instances', async () => {
        const { client, send } = graphClient();
        const result = await getActiveAlertSummary(client, 'sub', accountId, 'https://management.azure.com/');
        expect(result).toMatchObject({ available: true, ...counts });
        expect(send).toHaveBeenCalledOnce();
        const request = send.mock.calls[0][1];
        expect(request.url).toBe(
            'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01',
        );
        expect(request.method).toBe('POST');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        const body = JSON.parse(String(request.body)) as {
            subscriptions: string[];
            query: string;
            options: { resultFormat: string; allowPartialScopes: boolean };
        };
        expect(body.subscriptions).toEqual(['sub']);
        expect(body.options).toEqual({ resultFormat: 'objectArray', allowPartialScopes: false });
        expect(body.query).toContain('alertsmanagementresources');
        expect(body.query).toContain(`targetResource) =~ "${accountId}"`);
        expect(body.query).toContain("monitorCondition) =~ 'Fired'");
        expect(body.query).toContain("in~ ('Sev0', 'Sev1')");
        expect(body.query).toContain("in~ ('Sev2', 'Sev3')");
        expect(body.query).not.toMatch(/ago\(|startDateTime|alertState|timeRange/);
    });

    it('uses the sovereign ARM endpoint and escapes the account literal', async () => {
        const { client, send } = graphClient();
        const resourceId = `${accountId}"\\\n| take 1`;
        await getActiveAlertSummary(client, 'sub', resourceId, 'https://management.usgovcloudapi.net/');
        expect(send.mock.calls[0][1].url).toMatch(/^https:\/\/management\.usgovcloudapi\.net\//);
        const body = JSON.parse(String(send.mock.calls[0][1].body)) as { query: string };
        expect(body.query).toContain(`targetResource) =~ ${JSON.stringify(resourceId)}\n`);
    });

    it('accepts an explicit zero aggregate as no active alerts', async () => {
        const { client } = graphClient({
            ...complete,
            resultTruncated: false,
            data: [{ totalCount: 0, criticalCount: 0, warningCount: 0 }],
        });
        expect(await getActiveAlertSummary(client, 'sub', accountId, 'https://management.azure.com')).toMatchObject({
            available: true,
            totalCount: 0,
        });
    });

    it.each([
        null,
        { ...complete, resultTruncated: 'true' },
        { ...complete, $skipToken: 'more' },
        { ...complete, count: 0, totalRecords: 0, data: [] },
        { ...complete, totalRecords: 2 },
        { ...complete, data: [{ totalCount: 1, criticalCount: 2, warningCount: 0 }] },
        { ...complete, data: [{ totalCount: -1, criticalCount: 0, warningCount: 0 }] },
    ])('does not interpret a malformed or partial aggregate as recovery: %j', async (body) => {
        const { client } = graphClient(body);
        expect(await getActiveAlertSummary(client, 'sub', accountId, 'https://management.azure.com')).toMatchObject({
            available: false,
            reason: 'noData',
        });
    });

    it.each([401, 403, 500])('surfaces HTTP %s as unavailable rather than no alerts', async (status) => {
        const { client } = graphClient({}, status);
        expect(await getActiveAlertSummary(client, 'sub', accountId, 'https://management.azure.com')).toMatchObject({
            available: false,
            reason: status === 403 ? 'rbac' : 'noData',
        });
    });

    it('handles a missing client and transport errors as unavailable', async () => {
        expect(await getActiveAlertSummary(undefined, 'sub', accountId, 'https://management.azure.com')).toMatchObject({
            available: false,
        });
        const { client, send } = graphClient();
        send.mockRejectedValueOnce(new Error('Network unavailable'));
        expect(await getActiveAlertSummary(client, 'sub', accountId, 'https://management.azure.com')).toMatchObject({
            available: false,
        });
    });
});

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
    };
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
    };
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
    it.each([
        '/subscriptions/s/providers/Microsoft.AlertsManagement/alerts/abc',
        '/subscriptions/s/providers/Microsoft.AlertsManagement/alerts/a b?#%2F',
    ])('double-encodes the alert ID in the URL builder: %s', (id) => {
        const url = buildAlertPortalUrl(id);
        expect(url).toBe(
            `https://portal.azure.com/#view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId/${encodeURIComponent(encodeURIComponent(id))}/invokedFrom/CopyLinkFeature`,
        );
    });
});

describe('buildAccountAlertsPortalUrl', () => {
    it.each(['https://portal.azure.com/', 'https://portal.azure.us', 'https://portal.azure.cn/'])(
        'preserves cloud, tenant and resource scope for %s',
        (portal) => {
            const resourceId =
                '/subscriptions/sub/resourceGroups/a b/providers/Microsoft.DocumentDB/databaseAccounts/acct';
            const url = buildAccountAlertsPortalUrl(portal, 'tenant/name', resourceId);
            expect(url).toBe(
                `${portal.replace(/\/$/, '')}/#@tenant%2Fname/blade/Microsoft_Azure_Monitoring_Alerts/AlertsSummaryBlade/resourceId/${encodeURIComponent(encodeURIComponent(resourceId))}`,
            );
            expect(url).not.toContain('alertId/');
        },
    );
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

describe('getAlerts', () => {
    it.each(ALERT_MONITOR_CONDITIONS)(
        'filters %s by monitor condition, not incident state, in every window',
        async (condition) => {
            const client = new AlertsManagementClient({ getToken: async () => null });
            const getAll = vi.spyOn(client.alerts, 'getAll');
            for (const timeRange of ALERT_TIME_RANGES) {
                getAll.mockReturnValueOnce(
                    pagedItems([makeAlert('/alert', 'Sev1', { monitorCondition: condition, alertState: 'Closed' })]),
                );
                const result = await getAlerts(client, 'sub', '/acct', timeRange, condition);
                expect(getAll).toHaveBeenLastCalledWith('/subscriptions/sub', {
                    targetResource: '/acct',
                    timeRange,
                    monitorCondition: condition,
                });
                expect(result).toMatchObject({
                    available: true,
                    timeRange,
                    monitorCondition: condition,
                    criticalCount: 1,
                });
                expect(result.alerts[0]).toMatchObject({ monitorCondition: condition, alertState: 'Closed' });
            }
        },
    );

    it.each([
        'https://portal.azure.com/',
        'https://ms.portal.azure.com',
        'https://portal.azure.us/',
        'https://portal.azure.cn',
    ])('preserves the configured portal %s and tenant when constructing alert links', async (portal) => {
        const id = '/subscriptions/sub/providers/Microsoft.AlertsManagement/alerts/a b?#%';
        const result = await getAlerts(
            mockAlertsClient([makeAlert(id, 'Sev1')]),
            'sub',
            '/acct',
            '1d',
            'Fired',
            portal,
            'tenant/# ?@',
        );
        expect(result.alerts[0].portalUrl).toBe(
            `${portal.replace(/\/$/, '')}/#@tenant%2F%23%20%3F%40/view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId/${encodeURIComponent(encodeURIComponent(id))}/invokedFrom/CopyLinkFeature`,
        );
    });

    it('maps severities, counts, and sorts, with per-alert portal links', async () => {
        const client = mockAlertsClient([
            makeAlert('/a/warn', 'Sev2', { startDateTime: new Date(1000) }),
            makeAlert('/a/crit', 'Sev1', { startDateTime: new Date(2000), alertRule: 'rule-x' }),
            makeAlert('/a/info', 'Sev4'),
        ]);

        const result = await getAlerts(client, 'sub1', '/acct', '1d', 'Fired');

        expect(result.available).toBe(true);
        expect(result.criticalCount).toBe(1);
        expect(result.warningCount).toBe(1);
        expect(result.alerts.map((a) => a.severity)).toEqual(['Critical', 'Warning', 'Informational']);
        expect(result.alerts[0].portalUrl).toContain('AlertDetails.ReactView');
        expect(result.alerts[0].startedAt).toBe(2000);
    });

    it.each(ALERT_MONITOR_CONDITIONS)(
        'returns unavailable with the %s filter when Alerts Management throws',
        async (condition) => {
            const result = await getAlerts(mockAlertsClient([], true), 'sub1', '/acct', '7d', condition);
            expect(result.available).toBe(false);
            expect(result.alerts).toEqual([]);
            expect(result).toMatchObject({ timeRange: '7d', monitorCondition: condition });
        },
    );

    it('returns available: true with no alerts when the scope is clean', async () => {
        const result = await getAlerts(mockAlertsClient([]), 'sub1', '/acct', '30d', 'Fired');
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

// ─── Multi-panel rate-limit smoke test (plan Phase 8) ─────────────────────────────
//
// Advisor has no per-resource endpoint, so every open dashboard would otherwise fire its own
// subscription-wide `recommendations.list()` on each 60 s poll. The subscription-wide batch cache
// (in-flight promise sharing + short TTL) is meant to collapse those into one ARM read per poll tick,
// no matter how many dashboards are open in the subscription.
//
// Rather than assert an absolute call count (which would have to be re-edited whenever the cadence or
// TTL changes), this pins the *invariant* the coalescing exists for: extra panels must add zero
// subscription-wide reads. The "hour" is a virtual clock advanced through the `now` argument — there is
// no real waiting, so the whole run is instant.
describe('multi-panel Advisor rate-limit smoke test', () => {
    const POLL_INTERVAL_MS = 60_000;
    const ONE_HOUR_MS = 60 * 60_000;
    const TICKS_PER_HOUR = ONE_HOUR_MS / POLL_INTERVAL_MS;

    const account = (i: number) => `/subscriptions/sub1/providers/Microsoft.DocumentDB/databaseAccounts/acct${i}`;

    beforeEach(() => {
        __resetAdvisorCache();
    });

    async function countAdvisorReads(panelCount: number): Promise<number> {
        __resetAdvisorCache();
        const { client, calls } = mockAdvisorClient([makeRec(account(0), 'High', 'Performance')]);
        const start = Date.now();
        const accounts = Array.from({ length: panelCount }, (_, i) => account(i));

        // Advance a virtual clock one poll interval at a time; every panel polls concurrently on each tick.
        for (let elapsed = 0; elapsed < ONE_HOUR_MS; elapsed += POLL_INTERVAL_MS) {
            const now = start + elapsed;
            await Promise.all(accounts.map((acct) => getRecommendations(client, 'sub1', acct, now)));
        }
        return calls();
    }

    it('adds zero subscription-wide reads per extra panel (5 dashboards cost the same as 1)', async () => {
        const onePanelReads = await countAdvisorReads(1);
        const fivePanelReads = await countAdvisorReads(5);

        // The coalescing guarantee, robust to any cadence/TTL change: panel count does not move the budget.
        expect(fivePanelReads).toBe(onePanelReads);
    });

    it('never exceeds one subscription-wide read per poll tick over the window', async () => {
        const reads = await countAdvisorReads(5);
        expect(reads).toBeGreaterThan(0);
        expect(reads).toBeLessThanOrEqual(TICKS_PER_HOUR);
    });

    it('coalesces concurrent polls within a single tick to exactly one read', async () => {
        const { client, calls } = mockAdvisorClient([makeRec(account(0), 'High', 'Performance')]);
        const now = Date.now();
        const accounts = Array.from({ length: 5 }, (_, i) => account(i));

        const results = await Promise.all(accounts.map((acct) => getRecommendations(client, 'sub1', acct, now)));

        expect(calls()).toBe(1);
        expect(results.every((r) => r.available)).toBe(true);
    });
});
