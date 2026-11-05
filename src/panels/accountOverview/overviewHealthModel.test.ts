/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    deriveOverviewHealth,
    escalateAccountHealth,
    provisioningHealthCheck,
    resolveAccountHealth,
    rowHealth,
} from './overviewHealthModel';
import { type DerivedAdvisory } from './services/advisories/core/types';

const empty: Parameters<typeof deriveOverviewHealth>[0] = {
    accountLoading: false,
    activeAlertsLoading: false,
    activeAlertsUnavailable: false,
    inventory: { available: true, supported: true, rows: [] },
    inventoryMetricsLoading: false,
    recommendationsLoading: false,
};

const advisory: DerivedAdvisory = {
    id: 'idle',
    rule: 'IdleContainer',
    severity: 'High',
    title: 'Idle container',
    rationale: 'Almost no traffic was observed.',
    suggestedAction: 'Review unused capacity.',
    thresholdReference: 'Idle threshold.',
};

describe('Overview health model', () => {
    it('keeps absent evidence unknown and does not create tab warnings', () => {
        const model = deriveOverviewHealth(empty);
        expect(model.health).toBeUndefined();
        expect(model.indicators).toEqual({});
        expect(model.checks).toContainEqual({ kind: 'advisor', outcome: 'unavailable', detail: 'unavailable' });
        expect(model.checks).toContainEqual({
            kind: 'requests',
            outcome: 'unavailable',
            detail: 'failed',
            reason: undefined,
        });
    });

    it.each([
        ['Critical', 'Needs Attention', 'Critical'],
        ['Needs Attention', undefined, 'Needs Attention'],
        ['Healthy', undefined, undefined],
        [undefined, undefined, undefined],
    ] as const)('folds container %s into health %s and indicator %s', (container, expected, indicator) => {
        const model = deriveOverviewHealth({
            ...empty,
            inventory: {
                available: true,
                supported: true,
                rows: [{ databaseId: 'db', containerId: 'container', health: 'Healthy' }],
            },
            inventoryMetrics: { metrics: { 'db/container': { health: container } } },
        });
        expect(model.health).toBe(expected);
        expect(model.indicators.databases?.severity).toBe(indicator);
        expect(model.checks).toContainEqual({
            kind: 'containers',
            outcome: container === 'Critical' ? 'warning' : container ? 'passed' : 'unavailable',
            critical: Number(container === 'Critical'),
            warning: Number(container === 'Needs Attention'),
            unassessed: Number(container === undefined),
        });
    });

    it('retains critical alert evidence when the current check is unavailable', () => {
        const summary = { available: true, totalCount: 2, criticalCount: 1, warningCount: 1, generatedAt: 1 };
        const model = deriveOverviewHealth({
            ...empty,
            account: { available: true, health: 'Healthy', generatedAt: 1 },
            activeAlerts: summary,
            activeAlertsUnavailable: true,
        });
        expect(model.health).toBe('Critical');
        expect(model.indicators.advisories).toEqual({
            severity: 'Critical',
            reasons: [{ kind: 'criticalAlerts' }, { kind: 'warningAlerts' }],
        });
        expect(model.checks).toContainEqual({
            kind: 'alerts',
            outcome: 'unavailable',
            stale: true,
            summary,
        });
    });

    it('does not turn informational alerts into degraded health', () => {
        const model = deriveOverviewHealth({
            ...empty,
            account: { available: true, health: 'Healthy', generatedAt: 1 },
            activeAlerts: { available: true, totalCount: 3, criticalCount: 0, warningCount: 0, generatedAt: 1 },
        });
        expect(model.health).toBe('Healthy');
        expect(model.indicators.advisories).toBeUndefined();
    });

    it('uses account throttling and only available Advisor evidence', () => {
        const model = deriveOverviewHealth({
            ...empty,
            account: { available: true, health: 'Critical', hasSustainedThrottling: true, generatedAt: 1 },
            accountLoading: true,
            recommendations: { available: false, hasHighImpactPerfCost: true, recommendations: [] },
        });
        expect(model.health).toBe('Critical');
        expect(model.indicators).toEqual({
            monitoring: { severity: 'Critical', reasons: [{ kind: 'accountThrottling' }] },
        });
        expect(model.checks).toContainEqual({
            kind: 'requests',
            outcome: 'loading',
            detail: 'throttled',
            reason: undefined,
        });
        expect(
            deriveOverviewHealth({
                ...empty,
                recommendations: { available: true, hasHighImpactPerfCost: true, recommendations: [] },
            }).health,
        ).toBe('Needs Attention');
    });

    it.each(['High', 'Medium', 'Low'] as const)(
        'uses %s Advisor recommendations in non-health categories only for the tab indicator',
        (impact) => {
            const model = deriveOverviewHealth({
                ...empty,
                account: { available: true, health: 'Healthy', generatedAt: 1 },
                recommendations: {
                    available: true,
                    hasHighImpactPerfCost: false,
                    recommendations: ['HighAvailability', 'Security', 'OperationalExcellence'].map((category) => ({
                        id: category,
                        category,
                        impact,
                        problem: 'Review account configuration.',
                    })),
                },
            });
            expect(model.health).toBe('Healthy');
            expect(model.indicators.advisories).toEqual(
                impact === 'Low'
                    ? undefined
                    : {
                          severity: 'Needs Attention',
                          reasons: [{ kind: 'advisorRecommendations', count: 3 }],
                      },
            );
            expect(model.checks).toContainEqual({ kind: 'advisor', outcome: 'passed', detail: 'clear' });
        },
    );

    it.each(['High', 'Medium', 'Low'] as const)(
        'uses visible %s derived findings without establishing account health',
        (severity) => {
            const model = deriveOverviewHealth({
                ...empty,
                derivedAdvisories: { available: true, advisories: [{ ...advisory, severity }] },
            });
            expect(model.health).toBeUndefined();
            expect(model.indicators.advisories).toEqual(
                severity === 'Low'
                    ? undefined
                    : {
                          severity: 'Needs Attention',
                          reasons: [{ kind: 'derivedAdvisories', count: 1 }],
                      },
            );
        },
    );

    it('excludes dismissed and superseded findings and ignores partial coverage alone', () => {
        const model = deriveOverviewHealth({
            ...empty,
            derivedAdvisories: {
                available: true,
                advisories: [
                    { ...advisory, id: 'dismissed' },
                    { ...advisory, id: 'superseded', supersededBy: 'replacement' },
                    { ...advisory, id: 'low', severity: 'Low' },
                ],
            },
            dismissedAdvisoryIds: new Set(['dismissed']),
        });
        expect(model.indicators.advisories).toBeUndefined();
        const partial = {
            available: true,
            advisories: [],
            metricSource: { available: false, failures: [{ rule: 'IdleContainer', reason: 'noData' }] },
            logSource: { available: false, reason: 'rbac' },
        };
        expect(deriveOverviewHealth({ ...empty, derivedAdvisories: partial }).indicators.advisories).toBeUndefined();
    });

    it('ignores unavailable recommendation results even when they retain findings', () => {
        const model = deriveOverviewHealth({
            ...empty,
            recommendations: {
                available: false,
                hasHighImpactPerfCost: true,
                recommendations: [{ id: 'ha', category: 'HighAvailability', impact: 'High', problem: 'Review HA.' }],
            },
            derivedAdvisories: { available: false, advisories: [advisory] },
        });
        expect(model.health).toBeUndefined();
        expect(model.indicators.advisories).toBeUndefined();
    });

    it('combines both recommendation sources without downgrading a critical alert', () => {
        const model = deriveOverviewHealth({
            ...empty,
            activeAlerts: { available: true, totalCount: 1, criticalCount: 1, warningCount: 0, generatedAt: 1 },
            recommendations: {
                available: true,
                hasHighImpactPerfCost: false,
                recommendations: [{ id: 'ha', category: 'HighAvailability', impact: 'High', problem: 'Review HA.' }],
            },
            derivedAdvisories: { available: true, advisories: [advisory] },
        });
        expect(model.health).toBe('Critical');
        expect(model.indicators.advisories).toEqual({
            severity: 'Critical',
            reasons: [
                { kind: 'criticalAlerts' },
                { kind: 'advisorRecommendations', count: 1 },
                { kind: 'derivedAdvisories', count: 1 },
            ],
        });
    });

    it('uses one escalation policy including critical containers without downgrading the base', () => {
        const signals = {
            hasCriticalAlert: false,
            hasWarningAlert: false,
            hasHighImpactPerfCostRec: false,
            hasCriticalContainer: true,
        };
        expect(escalateAccountHealth('Healthy', signals)).toBe('Needs Attention');
        expect(escalateAccountHealth('Critical', signals)).toBe('Critical');
    });

    it('preserves provisioning precedence and suppresses Healthy after an unavailable alert check', () => {
        expect(resolveAccountHealth('Failed', 'Healthy', false)).toBe('Critical');
        expect(resolveAccountHealth('Updating', 'Critical', false)).toBe('Critical');
        expect(resolveAccountHealth('Updating', 'Healthy', true)).toBe('Needs Attention');
        expect(resolveAccountHealth('Succeeded', 'Healthy', true)).toBeUndefined();
        expect(resolveAccountHealth('Succeeded', undefined, false)).toBeUndefined();
        expect(provisioningHealthCheck('Succeeded')).toEqual({
            kind: 'provisioning',
            state: 'Succeeded',
            outcome: 'passed',
        });
    });

    it('shares the existing inventory fallback without inventing serverless RU health', () => {
        expect(rowHealth({ health: 'Healthy' }, undefined)).toBe('Healthy');
        expect(rowHealth({ health: 'Healthy' }, { health: undefined })).toBe('Unknown');
        expect(
            rowHealth({ health: 'Healthy' }, undefined, {
                status: 'notApplicable',
                reason: 'serverlessNormalizedRu',
            }),
        ).toBe('Unknown');
    });
});
