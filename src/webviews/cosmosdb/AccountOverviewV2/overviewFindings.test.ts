/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DerivedAdvisory } from '../../api/types';
import {
    collectOverviewFindings,
    type OverviewFinding,
    rankOverviewFindings,
    unavailableSummary,
} from './overviewFindingsModel';

const finding = (id: string, overrides: Partial<OverviewFinding> = {}): OverviewFinding => ({
    id,
    source: 'derived',
    priority: 1,
    severity: 'High',
    title: id,
    scope: 'database/container',
    rationale: 'Observed evidence',
    recommendation: false,
    ...overrides,
});

const advisory: DerivedAdvisory = {
    id: 'hot-partition',
    rule: 'HotPartitionRisk',
    severity: 'High',
    title: 'Hot partition',
    rationale: 'Busiest partition is saturated while another has headroom.',
    suggestedAction: 'Review the partition key.',
    thresholdReference: 'Configured threshold: 90%',
    scope: 'database/container',
};

const input = (): Parameters<typeof collectOverviewFindings>[0] => ({
    alerts: { available: true, alerts: [], criticalCount: 0, warningCount: 0, timeRange: '1d', generatedAt: 1 },
    alertTimeRange: '1d',
    recommendations: { available: true, recommendations: [], hasHighImpactPerfCost: false, generatedAt: 1 },
    derivedAdvisories: { available: true, advisories: [advisory], generatedAt: 1 },
    dismissedAdvisoryIds: new Set(),
});

describe('overview findings ranking', () => {
    it('orders severity first, then source, scope and stable ID independently of input order', () => {
        const values = [
            finding('low', { priority: 3 }),
            finding('advisor', { source: 'advisor' }),
            finding('z', { scope: 'z/container' }),
            finding('b'),
            finding('a'),
            finding('warning', { source: 'alert' }),
            finding('critical', { source: 'alert', priority: 0 }),
        ];
        const ids = ['critical', 'warning', 'a', 'b', 'z', 'advisor', 'low'];
        expect(rankOverviewFindings(values).map((item) => item.id)).toEqual(ids);
        expect(rankOverviewFindings([...values].reverse()).map((item) => item.id)).toEqual(ids);
        expect(values[0].id).toBe('low');
    });

    it('only deduplicates the same source and stable ID, not related signals across sources or scopes', () => {
        const a = finding('same');
        const result = rankOverviewFindings([
            a,
            { ...a },
            finding('same', { source: 'alert' }),
            finding('another-scope', { scope: 'other/container' }),
        ]);
        expect(result).toHaveLength(3);
        expect(result.filter((item) => item.id === 'same')).toHaveLength(2);
    });

    it('preserves evidence and respects session-dismissed derived IDs without hiding Azure IDs', () => {
        const state = input();
        state.dismissedAdvisoryIds = new Set([advisory.id]);
        state.alerts!.alerts.push({
            id: advisory.id,
            name: 'Azure alert',
            severity: 'Critical',
            rawSeverity: 'Sev0',
            targetResource: 'account-resource',
            portalUrl: 'https://portal.azure.com',
        });
        const result = collectOverviewFindings(state);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ source: 'alert', scope: 'account-resource', recommendation: false });
        const derived = collectOverviewFindings(input())[0];
        expect(derived).toMatchObject({
            rationale: advisory.rationale,
            action: advisory.suggestedAction,
            threshold: advisory.thresholdReference,
        });
    });

    it('does not promote unavailable source contents or old alert-window results to current findings', () => {
        const state = input();
        state.derivedAdvisories!.available = false;
        state.alerts!.timeRange = '7d';
        state.alerts!.alerts.push({
            id: 'stale',
            name: 'Stale',
            severity: 'Critical',
            rawSeverity: 'Sev0',
            portalUrl: 'https://portal.azure.com',
        });
        expect(collectOverviewFindings(state)).toEqual([]);
    });

    it('keeps opportunities in recommendations and does not invent Advisor scope or confidence', () => {
        const state = input();
        state.derivedAdvisories!.advisories.push({ ...advisory, id: 'over', rule: 'OverProvisioning' });
        state.recommendations!.recommendations.push({
            id: 'advisor',
            category: 'Cost',
            impact: 'High',
            problem: 'Cost opportunity',
            solution: 'Inspect configuration',
            potentialBenefit: 'USD 20',
        });
        const result = collectOverviewFindings(state);
        expect(result.find((item) => item.id === 'over')?.recommendation).toBe(true);
        expect(result.find((item) => item.id === 'advisor')).toMatchObject({
            source: 'advisor',
            severity: 'High impact',
            benefit: 'USD 20',
            scope: 'Account-associated; detailed resource scope is not provided',
        });
        expect(result.some((item) => 'confidence' in item)).toBe(false);
    });

    it('retains the complete ranked list beyond summary limits', () => {
        const state = input();
        state.derivedAdvisories!.advisories = Array.from({ length: 12 }, (_, index) => ({
            ...advisory,
            id: `id-${index}`,
        }));
        expect(collectOverviewFindings(state)).toHaveLength(12);
    });

    it('uses distinct explanations for missing permissions, diagnostic settings, support and data', () => {
        const messages = ['rbac', 'logAnalyticsDisabled', 'unsupported', 'noData', undefined].map((reason) =>
            unavailableSummary(reason as Parameters<typeof unavailableSummary>[0]),
        );
        expect(new Set(messages).size).toBe(5);
        expect(messages.join(' ')).not.toMatch(/healthy|0%/i);
    });
});
