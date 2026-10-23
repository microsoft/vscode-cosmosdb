/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MetricApplicability, type MetricUnavailableReason } from './metrics/contracts';
import { type AccountHealthResult } from './services/accountHealth';
import { type ActiveAlertSummary, type RecommendationsResult } from './services/alertsRecommendations';
import { type InventoryContainerRow } from './services/inventory';
import { type ContainerMetrics } from './services/inventoryMetrics';
import { type HealthState, type ProvisioningState } from './services/shared';

export interface AccountHealthSignals {
    hasCriticalAlert: boolean;
    hasWarningAlert: boolean;
    hasHighImpactPerfCostRec: boolean;
    hasCriticalContainer?: boolean;
}

const HEALTH_ORDER: Record<HealthState, number> = { Healthy: 0, 'Needs Attention': 1, Critical: 2 };

export function deriveAccountHealth(
    provisioningState: ProvisioningState | undefined,
    hasSustainedThrottling: boolean,
    hasHealthTelemetry: boolean,
): HealthState | undefined {
    if (hasSustainedThrottling || provisioningState === 'Failed' || provisioningState === 'Canceled') {
        return 'Critical';
    }
    if (provisioningState === 'Creating' || provisioningState === 'Updating' || provisioningState === 'Deleting') {
        return 'Needs Attention';
    }
    return hasHealthTelemetry ? 'Healthy' : undefined;
}

/** Account-wide signals can establish Critical; a Critical container establishes only Needs Attention. */
export function escalateAccountHealth(base: HealthState, signals: AccountHealthSignals): HealthState {
    const signalHealth = signals.hasCriticalAlert
        ? 'Critical'
        : signals.hasWarningAlert || signals.hasHighImpactPerfCostRec || signals.hasCriticalContainer
          ? 'Needs Attention'
          : 'Healthy';
    return HEALTH_ORDER[base] >= HEALTH_ORDER[signalHealth] ? base : signalHealth;
}

export function resolveAccountHealth(
    provisioningState: ProvisioningState | undefined,
    accountHealth: HealthState | undefined,
    activeAlertsUnavailable: boolean,
): HealthState | undefined {
    const provisioning = deriveAccountHealth(provisioningState, false, false);
    const known =
        provisioning && (!accountHealth || HEALTH_ORDER[provisioning] > HEALTH_ORDER[accountHealth])
            ? provisioning
            : accountHealth;
    return activeAlertsUnavailable && known === 'Healthy' ? undefined : known;
}

export function rowHealth(
    row: Pick<InventoryContainerRow, 'health'>,
    metric: Pick<ContainerMetrics, 'health'> | undefined,
    normalizedRuApplicability?: MetricApplicability,
): HealthState | 'Unknown' {
    if (metric) {
        return metric.health ?? 'Unknown';
    }
    return normalizedRuApplicability?.status === 'notApplicable' ? 'Unknown' : row.health;
}

export type HealthCheckOutcome = 'passed' | 'warning' | 'critical' | 'unavailable' | 'loading';
export type OverviewHealthCheck = { outcome: HealthCheckOutcome } & (
    | { kind: 'provisioning'; state?: ProvisioningState }
    | {
          kind: 'requests';
          detail: 'throttled' | 'clear' | 'loading' | 'unavailable' | 'failed';
          reason?: MetricUnavailableReason;
      }
    | { kind: 'containers'; critical: number; warning: number; unassessed: number }
    | { kind: 'alerts'; stale: boolean; summary?: ActiveAlertSummary }
    | { kind: 'advisor'; detail: 'warning' | 'clear' | 'unavailable' }
);

export type HealthIndicatorReason =
    | { kind: 'accountThrottling' | 'criticalAlerts' | 'warningAlerts' | 'advisor' }
    | { kind: 'criticalContainers' | 'warningContainers'; count: number };

export interface HealthIndicator {
    severity: 'Critical' | 'Needs Attention';
    reasons: HealthIndicatorReason[];
}

export interface OverviewHealthModel {
    health?: HealthState;
    checks: OverviewHealthCheck[];
    indicators: Partial<Record<'monitoring' | 'databases' | 'advisories', HealthIndicator>>;
}

export function provisioningHealthCheck(state: ProvisioningState | undefined): OverviewHealthCheck {
    const health = deriveAccountHealth(state, false, false);
    return {
        kind: 'provisioning',
        state,
        outcome:
            state === 'Succeeded'
                ? 'passed'
                : health === 'Critical'
                  ? 'critical'
                  : health === 'Needs Attention'
                    ? 'warning'
                    : 'unavailable',
    };
}

export function deriveOverviewHealth({
    account,
    accountLoading,
    activeAlerts,
    activeAlertsLoading,
    activeAlertsUnavailable,
    inventory,
    inventoryMetrics,
    inventoryMetricsLoading,
    normalizedRuApplicability,
    recommendations,
    recommendationsLoading,
}: {
    account?: AccountHealthResult;
    accountLoading: boolean;
    activeAlerts?: ActiveAlertSummary;
    activeAlertsLoading: boolean;
    activeAlertsUnavailable: boolean;
    inventory: {
        available: boolean;
        supported: boolean;
        rows: Pick<InventoryContainerRow, 'databaseId' | 'containerId' | 'health'>[];
    };
    inventoryMetrics?: { metrics: Record<string, Pick<ContainerMetrics, 'health'>> };
    inventoryMetricsLoading: boolean;
    normalizedRuApplicability?: MetricApplicability;
    recommendations?: Pick<RecommendationsResult, 'available' | 'hasHighImpactPerfCost'>;
    recommendationsLoading: boolean;
}): OverviewHealthModel {
    const containerHealth =
        inventory.available && inventory.supported
            ? inventory.rows.map((row) =>
                  rowHealth(
                      row,
                      inventoryMetrics?.metrics[`${row.databaseId}/${row.containerId}`],
                      normalizedRuApplicability,
                  ),
              )
            : [];
    const critical = containerHealth.filter((health) => health === 'Critical').length;
    const warning = containerHealth.filter((health) => health === 'Needs Attention').length;
    const unassessed = inventory.rows.filter(
        (row) => !inventoryMetrics?.metrics[`${row.databaseId}/${row.containerId}`]?.health,
    ).length;
    const signals: AccountHealthSignals = {
        hasCriticalAlert: activeAlerts ? activeAlerts.criticalCount > 0 : false,
        hasWarningAlert: activeAlerts ? activeAlerts.warningCount > 0 : false,
        hasHighImpactPerfCostRec: recommendations?.available ? recommendations.hasHighImpactPerfCost : false,
        hasCriticalContainer: critical > 0,
    };
    const health =
        account?.health !== undefined
            ? escalateAccountHealth(account.health, signals)
            : Object.values(signals).some(Boolean)
              ? escalateAccountHealth('Healthy', signals)
              : undefined;
    const indicators: OverviewHealthModel['indicators'] = {};
    if (account?.hasSustainedThrottling) {
        indicators.monitoring = { severity: 'Critical', reasons: [{ kind: 'accountThrottling' }] };
    }
    if (critical > 0) {
        indicators.databases = {
            severity: 'Critical',
            reasons: [{ kind: 'criticalContainers', count: critical }],
        };
    } else if (warning > 0) {
        indicators.databases = {
            severity: 'Needs Attention',
            reasons: [{ kind: 'warningContainers', count: warning }],
        };
    }
    const advisoryReasons: HealthIndicatorReason[] = [];
    if (signals.hasCriticalAlert) {
        advisoryReasons.push({ kind: 'criticalAlerts' });
    }
    if (signals.hasWarningAlert) {
        advisoryReasons.push({ kind: 'warningAlerts' });
    }
    if (signals.hasHighImpactPerfCostRec) {
        advisoryReasons.push({ kind: 'advisor' });
    }
    if (advisoryReasons.length > 0) {
        indicators.advisories = {
            severity: signals.hasCriticalAlert ? 'Critical' : 'Needs Attention',
            reasons: advisoryReasons,
        };
    }
    return {
        health,
        indicators,
        checks: [
            {
                kind: 'requests',
                outcome: accountLoading
                    ? 'loading'
                    : account?.hasSustainedThrottling
                      ? 'critical'
                      : account?.available
                        ? 'passed'
                        : 'unavailable',
                detail: account?.available
                    ? account.hasSustainedThrottling
                        ? 'throttled'
                        : 'clear'
                    : accountLoading
                      ? 'loading'
                      : account
                        ? 'unavailable'
                        : 'failed',
                reason: account?.reason,
            },
            {
                kind: 'containers',
                outcome:
                    critical > 0
                        ? 'warning'
                        : inventoryMetricsLoading
                          ? 'loading'
                          : !inventory.available || !inventory.supported || unassessed > 0
                            ? 'unavailable'
                            : 'passed',
                critical,
                warning,
                unassessed,
            },
            {
                kind: 'alerts',
                outcome: activeAlertsLoading
                    ? 'loading'
                    : activeAlertsUnavailable || !activeAlerts?.available
                      ? 'unavailable'
                      : signals.hasCriticalAlert
                        ? 'critical'
                        : signals.hasWarningAlert
                          ? 'warning'
                          : 'passed',
                stale: activeAlertsUnavailable,
                summary: activeAlerts?.available ? activeAlerts : undefined,
            },
            {
                kind: 'advisor',
                outcome: recommendationsLoading
                    ? 'loading'
                    : !recommendations?.available
                      ? 'unavailable'
                      : signals.hasHighImpactPerfCostRec
                        ? 'warning'
                        : 'passed',
                detail: recommendations?.available
                    ? signals.hasHighImpactPerfCostRec
                        ? 'warning'
                        : 'clear'
                    : 'unavailable',
            },
        ],
    };
}
