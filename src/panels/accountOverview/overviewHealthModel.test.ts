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

const empty: Parameters<typeof deriveOverviewHealth>[0] = {
    accountLoading: false,
    activeAlertsLoading: false,
    activeAlertsUnavailable: false,
    inventory: { available: true, supported: true, rows: [] },
    inventoryMetricsLoading: false,
    recommendationsLoading: false,
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
            recommendations: { available: false, hasHighImpactPerfCost: true },
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
                recommendations: { available: true, hasHighImpactPerfCost: true },
            }).health,
        ).toBe('Needs Attention');
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
