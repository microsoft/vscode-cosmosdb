/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DerivedAdvisory, type DerivedAdvisoryRule } from '../../api/types';
import { ruleMeta } from '../AccountOverview/derivedAdvisoryRuleMeta';
import {
    collectOverviewFindings,
    derivedFindingPresentation,
    groupOverviewHealthFindings,
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

describe('overview health grouping', () => {
    const derived = (id: string, overrides: Partial<OverviewFinding> = {}): OverviewFinding =>
        finding(id, { rule: 'HotPartitionRisk', ...overrides });

    it('returns every health group ranked by criticality, leaving the three-group cutoff to the caller', () => {
        const result = groupOverviewHealthFindings([
            derived('hot-a'),
            derived('hot-b', { scope: 'database/other' }),
            derived('storage', { rule: 'StorageGrowthRisk', priority: 2, severity: 'Medium' }),
            derived('consistency', { rule: 'ExpensiveConsistency', priority: 3, severity: 'Low' }),
            finding('warning', { source: 'alert', severity: 'Warning' }),
            finding('critical', { source: 'alert', priority: 0, severity: 'Critical' }),
            derived('capacity', { rule: 'OverProvisioning', recommendation: true }),
            finding('advisor', { source: 'advisor', recommendation: true }),
        ]);
        expect(result).toHaveLength(5);
        expect(result.map((item) => item.priority)).toEqual([0, 1, 1, 2, 3]);
        expect(result.map((item) => item.source)).toEqual(['alert', 'alert', 'derived', 'derived', 'derived']);
        expect(result.filter((item) => item.recommendation)).toEqual([]);
    });

    it('uses the worst severity, not the first member, and replaces individual evidence with detector copy', () => {
        const low = derived('low', { scope: 'database/a', priority: 3, severity: 'Low' });
        const high = derived('high', {
            scope: 'database/z',
            title: 'database/z: 99% saturated',
            rationale: 'database/z uses 99% of its 400 RU/s.',
            action: 'Raise database/z to 800 RU/s.',
            threshold: '400 RU/s',
            estimatedImpact: 'Save 50% on database/z',
        });
        const result = groupOverviewHealthFindings([low, high]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            source: 'derived',
            rule: 'HotPartitionRisk',
            priority: 1,
            severity: 'High',
            title: ruleMeta('HotPartitionRisk').name,
            rationale: ruleMeta('HotPartitionRisk').description,
            summaryScope: 'database/a + others',
        });
        expect(result[0].action).toBeUndefined();
        expect(result[0].threshold).toBeUndefined();
        expect(result[0].rationale).not.toMatch(/99%|400|database\/z/);
        expect(result[0].estimatedImpact).toBe('May reduce hot-partition throttling');
        expect(high.estimatedImpact).toBe('Save 50% on database/z');
        expect(groupOverviewHealthFindings([high, low])).toEqual(result);
        expect(high.title).toBe('database/z: 99% saturated');
        expect(high.action).toBe('Raise database/z to 800 RU/s.');
    });

    it('deduplicates scopes, so multiple findings or regions on one container do not imply another container', () => {
        const values = [
            derived('east', { title: 'Hot partition in East US' }),
            derived('west', { title: 'Hot partition in West US' }),
            derived('east', { title: 'Hot partition in East US' }),
        ];
        expect(groupOverviewHealthFindings(values)[0].summaryScope).toBe('database/container');
        values.push(derived('other', { scope: 'database/other' }));
        expect(groupOverviewHealthFindings(values)[0].summaryScope).toBe('database/container + others');
        expect(rankOverviewFindings(values)).toHaveLength(3);
    });

    it.each<DerivedAdvisoryRule>([
        'HotPartitionRisk',
        'SustainedThrottlingInRegion',
        'StorageGrowthRisk',
        'StorageSkewRisk',
        'IndexingCostRisk',
        'CrossPartitionQuery',
    ])('never presents observed scopes as an exact affected total without coverage for %s', (rule) => {
        const values = Array.from({ length: 10 }, (_, index) =>
            derived(`observed-${index}`, { rule, scope: `database/container-${index}` }),
        );
        const [group] = groupOverviewHealthFindings(values);
        expect(group.summaryScope).toBe('database/container-0 + others');
        expect(group.summaryScope).not.toMatch(/\+\d|10 containers/);
        expect(groupOverviewHealthFindings(values.slice(0, 1))[0].summaryScope).toBe('database/container-0');
    });

    it('is stable across permutations, including tied severities and changed translated finding titles', () => {
        const values = [
            derived('z', { scope: 'database/z' }),
            derived('a', { scope: 'database/a' }),
            derived('storage', { rule: 'StorageGrowthRisk' }),
            finding('alert-b', { source: 'alert', alertRule: 'rule-b' }),
            finding('alert-a', { source: 'alert', alertRule: 'rule-a' }),
        ];
        const expected = groupOverviewHealthFindings(values);
        for (let index = 0; index < values.length; index++) {
            expect(groupOverviewHealthFindings([...values.slice(index), ...values.slice(0, index)])).toEqual(expected);
        }
        expect(groupOverviewHealthFindings([...values].reverse())).toEqual(expected);
        expect(
            groupOverviewHealthFindings(
                values.map((item) =>
                    item.source === 'derived' ? { ...item, title: 'Localized detector title' } : item,
                ),
            ),
        ).toEqual(expected);
    });

    it('groups by nonlocalized rule identity, never title or related evidence from another source', () => {
        const result = groupOverviewHealthFindings([
            derived('hot', { title: 'Same title' }),
            derived('storage', { title: 'Same title', rule: 'StorageGrowthRisk' }),
            finding('alert', { source: 'alert', title: 'Same title', alertRule: 'HotPartitionRisk' }),
            finding('legacy-a', { title: 'Same title' }),
            finding('legacy-b', { title: 'Same title' }),
        ]);
        expect(result).toHaveLength(5);
        expect(new Set(result.map((item) => item.id)).size).toBe(5);
        expect(result.filter((item) => item.source === 'derived').map((item) => item.rule)).toContain(
            'StorageGrowthRisk',
        );
    });

    it('groups alerts only by an explicit rule and counts distinct known target scopes, not alerts', () => {
        const result = groupOverviewHealthFindings([
            finding('warning-a', {
                source: 'alert',
                alertRule: 'rule',
                severity: 'Warning',
                scope: 'database/a',
            }),
            finding('critical-z', {
                source: 'alert',
                alertRule: 'rule',
                severity: 'Critical',
                priority: 0,
                scope: 'database/z',
            }),
            finding('warning-z', { source: 'alert', alertRule: 'rule', scope: 'database/z' }),
            finding('other-rule', { source: 'alert', alertRule: 'other-rule', title: 'Same alert title' }),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            source: 'alert',
            alertRule: 'rule',
            priority: 0,
            severity: 'Critical',
            summaryScope: 'database/a +1',
        });
        expect(result[1].alertRule).toBe('other-rule');
    });

    it('keeps alerts without an explicit rule separate by ID, including an empty rule', () => {
        const values = ['one', 'two', 'three'].map((id) =>
            finding(id, { source: 'alert', title: 'Same alert title', alertRule: id === 'three' ? '' : undefined }),
        );
        const result = groupOverviewHealthFindings([...values, { ...values[0] }]);
        expect(result.map((item) => item.id).sort()).toEqual(['one', 'three', 'two']);
        expect(result.every((item) => item.summaryScope === 'database/container')).toBe(true);
    });

    it('does not reuse a representative estimate without a supported derived detector', () => {
        const result = groupOverviewHealthFindings([
            finding('legacy', { estimatedImpact: 'Save 50%' }),
            finding('alert', { source: 'alert', alertRule: 'custom-rule', estimatedImpact: 'Save 50%' }),
        ]);
        expect(result).toHaveLength(2);
        expect(result.every((item) => item.estimatedImpact === undefined)).toBe(true);
    });

    it('excludes all Advisor recommendations from health grouping without collapsing the full list', () => {
        const values = [
            finding('one', { source: 'advisor', title: 'Same title', recommendation: true }),
            finding('two', { source: 'advisor', title: 'Same title', recommendation: true }),
        ];
        expect(groupOverviewHealthFindings(values)).toEqual([]);
        expect(rankOverviewFindings(values).map((item) => item.id)).toEqual(['one', 'two']);
    });

    it.each<DerivedAdvisoryRule>([
        'OverProvisioning',
        'AutoscaleCandidate',
        'IdleContainer',
        'PartitionMergeCandidate',
        'AutoscaleMaxOverProvisioned',
        'AutoscaleToManualCandidate',
        'ServerlessCandidate',
    ])('collects %s only as recommendations, preserving individual evidence and session dismissals', (rule) => {
        const state = input();
        state.derivedAdvisories!.advisories = [
            { ...advisory, id: 'one', rule, scope: 'database/a', severity: 'Low' },
            { ...advisory, id: 'two', rule, scope: 'database/b', severity: 'High' },
        ];
        const full = collectOverviewFindings(state);
        expect(full).toHaveLength(2);
        expect(full.every((item) => item.source === 'derived' && item.recommendation && item.rule === rule)).toBe(true);
        expect(full[0]).toMatchObject({
            id: 'two',
            rationale: advisory.rationale,
            action: advisory.suggestedAction,
            threshold: advisory.thresholdReference,
        });
        expect(groupOverviewHealthFindings(full)).toEqual([]);
        state.dismissedAdvisoryIds = new Set(['two']);
        const result = collectOverviewFindings(state);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ rule, severity: 'Low', scope: 'database/a', recommendation: true });
    });

    it('collects rule provenance and leaves all individual rows and evidence available to the full dialog', () => {
        const state = input();
        state.derivedAdvisories!.advisories = Array.from({ length: 12 }, (_, index) => ({
            ...advisory,
            id: `id-${index}`,
            scope: `database/container-${index}`,
            rationale: `Evidence ${index}`,
        }));
        state.alerts!.alerts.push({
            id: 'alert',
            name: 'Hot partition alert',
            severity: 'Critical',
            rawSeverity: 'Sev0',
            alertRule: 'monitor-hot-partition',
            portalUrl: 'https://portal.azure.com',
        });
        const full = collectOverviewFindings(state);
        const snapshot = structuredClone(full);
        expect(full).toHaveLength(13);
        expect(full[0].alertRule).toBe('monitor-hot-partition');
        expect(full.filter((item) => item.rule === 'HotPartitionRisk')).toHaveLength(12);
        expect(groupOverviewHealthFindings(full)).toHaveLength(2);
        expect(full).toEqual(snapshot);
        expect(collectOverviewFindings(state)).toEqual(snapshot);
        expect(full.find((item) => item.id === 'id-11')?.rationale).toBe('Evidence 11');
    });

    it('dismisses individual findings before grouping, never hiding an undismissed member of the same rule', () => {
        const state = input();
        state.derivedAdvisories!.advisories.push({
            ...advisory,
            id: 'remaining',
            scope: 'database/remaining',
            severity: 'Low',
        });
        const [before] = groupOverviewHealthFindings(collectOverviewFindings(state));
        state.dismissedAdvisoryIds = new Set([advisory.id]);
        const full = collectOverviewFindings(state);
        const after = groupOverviewHealthFindings(full);
        expect(full.map((item) => item.id)).toEqual(['remaining']);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
            id: before.id,
            severity: 'Low',
            priority: 3,
            summaryScope: 'database/remaining',
        });
        state.dismissedAdvisoryIds = new Set([advisory.id, 'remaining']);
        expect(groupOverviewHealthFindings(collectOverviewFindings(state))).toEqual([]);
    });

    it('keeps account and database scopes accurate without labelling them as containers', () => {
        const state = input();
        state.derivedAdvisories!.advisories = [
            { ...advisory, id: 'account', rule: 'ExpensiveConsistency', scope: undefined },
            { ...advisory, id: 'db-a', rule: 'SharedThroughputStarvation', scope: 'database-a' },
            { ...advisory, id: 'db-b', rule: 'SharedThroughputStarvation', scope: 'database-b' },
        ];
        state.alerts!.alerts.push({
            id: 'account-alert',
            name: 'Account alert',
            severity: 'Critical',
            rawSeverity: 'Sev0',
            targetResource: '/subscriptions/sub/databaseAccounts/account',
            portalUrl: 'https://portal.azure.com',
        });
        const result = groupOverviewHealthFindings(collectOverviewFindings(state));
        expect(result.find((item) => item.rule === 'ExpensiveConsistency')?.summaryScope).toBe('Account-wide');
        expect(result.find((item) => item.rule === 'SharedThroughputStarvation')?.summaryScope).toBe(
            'database-a + others',
        );
        expect(result.find((item) => item.source === 'alert')?.summaryScope).toBe(
            '/subscriptions/sub/databaseAccounts/account',
        );
        expect(result.some((item) => item.summaryScope?.includes('container'))).toBe(false);
        state.derivedAdvisories!.advisories.pop();
        expect(
            groupOverviewHealthFindings(collectOverviewFindings(state)).find(
                (item) => item.rule === 'SharedThroughputStarvation',
            )?.summaryScope,
        ).toBe('database-a');
    });
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

    it('combines derived opportunities with Advisor guidance without treating high importance as critical', () => {
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
        expect(result.filter((item) => item.recommendation).map((item) => item.id)).toEqual(['over', 'advisor']);
        expect(result.find((item) => item.id === 'advisor')).toMatchObject({
            source: 'advisor',
            recommendation: true,
            severity: 'High impact',
            priority: 1,
            benefit: 'USD 20',
            scope: 'Account-associated; detailed resource scope is not provided',
        });
        expect(result.some((item) => 'confidence' in item)).toBe(false);
        state.dismissedAdvisoryIds = new Set(['advisor', 'over']);
        state.derivedAdvisories!.available = false;
        expect(collectOverviewFindings(state).filter((item) => item.recommendation)).toEqual(
            result.filter((item) => item.source === 'advisor'),
        );
    });

    it('explicitly assigns each of the 18 rules to exactly one category with qualitative potential impact', () => {
        const expected = {
            HotPartitionRisk: false,
            SustainedThrottlingInRegion: false,
            OverProvisioning: true,
            AutoscaleCandidate: true,
            StorageGrowthRisk: false,
            StorageSkewRisk: false,
            IndexingCostRisk: false,
            ExpensiveConsistency: false,
            MultiRegionWriteAntipattern: false,
            IdleContainer: true,
            PartitionMergeCandidate: true,
            AutoscaleMaxOverProvisioned: true,
            AutoscaleToManualCandidate: true,
            ServerlessCandidate: true,
            CrossPartitionQuery: false,
            ShardKeyMisalignment: false,
            UncontrolledIngestion: false,
            SharedThroughputStarvation: false,
        } satisfies Record<DerivedAdvisoryRule, boolean>;
        const rules = Object.keys(expected) as DerivedAdvisoryRule[];
        expect(Object.keys(derivedFindingPresentation).sort()).toEqual([...rules].sort());
        const state = input();
        state.derivedAdvisories!.advisories = rules.map((rule) => ({ ...advisory, id: rule, rule }));
        const full = collectOverviewFindings(state);
        expect(full).toHaveLength(18);
        expect(full.filter((item) => item.recommendation)).toHaveLength(7);
        expect(groupOverviewHealthFindings(full)).toHaveLength(11);
        for (const rule of rules) {
            const matches = full.filter((item) => item.rule === rule);
            expect(matches).toHaveLength(1);
            expect(matches[0].recommendation).toBe(expected[rule]);
            expect(matches[0].estimatedImpact).toMatch(/^May /);
            expect(matches[0].estimatedImpact).not.toMatch(/\d|%|\$/);
        }
    });

    it.each(['Cost', 'Performance', 'HighAvailability', 'Security', 'OperationalExcellence'] as const)(
        'keeps all %s Advisor guidance in recommendations and does not invent impact estimates',
        (category) => {
            const state = input();
            state.recommendations!.recommendations.push({
                id: 'advisor',
                category,
                impact: 'High',
                problem: 'Guidance',
                solution: 'Review configuration',
            });
            state.alerts!.alerts.push({
                id: 'alert',
                name: 'Custom alert',
                severity: 'Critical',
                rawSeverity: 'Sev0',
                portalUrl: 'https://portal.azure.com',
            });
            const full = collectOverviewFindings(state);
            expect(full.find((item) => item.id === 'advisor')).toMatchObject({ recommendation: true, priority: 1 });
            expect(full.find((item) => item.id === 'advisor')?.estimatedImpact).toBeUndefined();
            expect(full.find((item) => item.id === 'alert')).toMatchObject({ recommendation: false, priority: 0 });
            expect(full.find((item) => item.id === 'alert')?.estimatedImpact).toBeUndefined();
        },
    );

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
