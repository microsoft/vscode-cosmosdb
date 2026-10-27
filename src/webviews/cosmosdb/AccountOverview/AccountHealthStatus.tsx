/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, type BadgeProps, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import {
    type HealthCheckOutcome,
    type HealthIndicatorReason,
    type OverviewHealthCheck,
    type OverviewHealthModel,
    provisioningHealthCheck,
    resolveAccountHealth,
} from '../../../panels/accountOverview/overviewHealthModel';
import { DIAGNOSTIC_POLICY } from '../../../panels/accountOverview/services/advisories/core/thresholds';
import { HOUR, MINUTE } from '../../../panels/accountOverview/services/units';
import { type HealthState, type ProvisioningState } from '../../api/types';
import { ThemedTooltip as Tooltip } from '../../common/ThemedTooltip';
import { unavailableCaption } from './metrics/descriptors';
import { type TabHealthIndicators } from './TabbedOverviewLayout';

export const PROVISIONING_LABELS: Record<ProvisioningState, string> = {
    Succeeded: l10n.t('Online'),
    Creating: l10n.t('Creating'),
    Updating: l10n.t('Updating'),
    Deleting: l10n.t('Deleting'),
    Failed: l10n.t('Failed'),
    Canceled: l10n.t('Canceled'),
};

const CHECK_OUTCOMES: Record<HealthCheckOutcome, string> = {
    passed: l10n.t('Passed'),
    warning: l10n.t('Needs Attention'),
    critical: l10n.t('Critical'),
    unavailable: l10n.t('Not assessed'),
    loading: l10n.t('Checking'),
};

const HEALTH_LABELS: Record<HealthState | 'Unknown', { tone: BadgeProps['color']; label: string }> = {
    Healthy: { tone: 'success', label: l10n.t('Healthy') },
    'Needs Attention': { tone: 'warning', label: l10n.t('Needs Attention') },
    Critical: { tone: 'danger', label: l10n.t('Critical') },
    Unknown: { tone: 'subtle', label: l10n.t('Unknown') },
};

function indicatorDescription(reason: HealthIndicatorReason): string {
    switch (reason.kind) {
        case 'accountThrottling':
            return l10n.t(
                'Critical: sustained account-wide throttling. Account health is Critical. Review request throttling in Monitoring.',
            );
        case 'criticalContainers':
            return l10n.t(
                'Critical containers: {count}. Account health is at least Needs Attention. Critical containers appear first in the table.',
                { count: reason.count },
            );
        case 'warningContainers':
            return l10n.t('Containers needing attention: {count}. These warnings do not escalate account health.', {
                count: reason.count,
            });
        case 'criticalAlerts':
            return l10n.t('Critical active alerts make account health Critical.');
        case 'warningAlerts':
            return l10n.t('Warning active alerts make account health at least Needs Attention.');
        case 'advisor':
            return l10n.t(
                'High-impact Performance or Cost recommendations make account health at least Needs Attention.',
            );
    }
}

export function healthIndicatorDescriptions(indicators: OverviewHealthModel['indicators']): TabHealthIndicators {
    return Object.fromEntries(
        Object.entries(indicators).map(([tab, indicator]) => [
            tab,
            { severity: indicator.severity, description: indicator.reasons.map(indicatorDescription).join(' ') },
        ]),
    );
}

function describeCheck(check: OverviewHealthCheck): { label: string; detail: string; outcome: HealthCheckOutcome } {
    switch (check.kind) {
        case 'provisioning':
            return {
                label: l10n.t('Resource provisioning'),
                outcome: check.outcome,
                detail: l10n.t('Resource provisioning state: {state}. See Status in Account details.', {
                    state: check.state ? PROVISIONING_LABELS[check.state] : l10n.t('Unknown'),
                }),
            };
        case 'requests': {
            const policy = DIAGNOSTIC_POLICY.sustainedThrottling;
            const duration = new Intl.NumberFormat(undefined, {
                style: 'unit',
                unit: 'minute',
                unitDisplay: 'long',
            }).format(policy.minDurationMs / MINUTE);
            const window = new Intl.NumberFormat(undefined, {
                style: 'unit',
                unit: 'hour',
                unitDisplay: 'long',
            }).format(policy.observation.windowMs / HOUR);
            const percent = (policy.shareThreshold * 100).toLocaleString();
            const details: Record<typeof check.detail, string> = {
                throttled: l10n.t(
                    'Account-wide 429 responses exceeded {percent}% for at least {duration} in the last {window}.',
                    { percent, duration, window },
                ),
                clear: l10n.t(
                    'No sustained account-wide 429 rate above {percent}% for {duration} in the last {window}.',
                    { percent, duration, window },
                ),
                loading: l10n.t('Checking account-wide requests over the last {window}.', { window }),
                unavailable: l10n.t(
                    'Account-wide request health over the last {window} could not be assessed: {reason}.',
                    { window, reason: unavailableCaption(check.reason) },
                ),
                failed: l10n.t('Account health could not be loaded. Try refreshing.'),
            };
            return { label: l10n.t('Account-wide throttling'), outcome: check.outcome, detail: details[check.detail] };
        }
        case 'containers':
            return {
                label: l10n.t('Container throttling'),
                outcome: check.outcome,
                detail:
                    l10n.t('Critical containers: {critical}. Warning containers: {warning}. Not assessed: {unknown}.', {
                        critical: check.critical,
                        warning: check.warning,
                        unknown: check.unassessed,
                    }) +
                    ' ' +
                    l10n.t(
                        'A Critical container raises account health to Needs Attention; warning-only containers do not. Provisioned containers use normalized RU peaks over the selected chart period and sustained 429 responses. Serverless containers use request observations and sustained 429 responses only.',
                    ),
            };
        case 'alerts':
            return {
                label: l10n.t('Active Azure Monitor alerts'),
                outcome: check.outcome,
                detail: [
                    check.stale
                        ? l10n.t('Active alerts could not be checked. Previously known problems are retained.')
                        : undefined,
                    check.summary
                        ? l10n.t('Active alerts: {total}; Sev0/1: {critical}; Sev2/3: {warning}.', {
                              total: check.summary.totalCount,
                              critical: check.summary.criticalCount,
                              warning: check.summary.warningCount,
                          })
                        : undefined,
                    l10n.t(
                        'Resource Graph checks all retained Fired alerts, independently of the list filters. Resolved alerts and Sev4 do not affect health.',
                    ),
                ]
                    .filter(Boolean)
                    .join(' '),
            };
        case 'advisor':
            return {
                label: l10n.t('Azure Advisor'),
                outcome: check.outcome,
                detail:
                    check.detail === 'warning'
                        ? l10n.t(
                              'High-impact Performance or Cost recommendations make account health at least Needs Attention.',
                          )
                        : check.detail === 'clear'
                          ? l10n.t('No high-impact Performance or Cost recommendations.')
                          : l10n.t('Advisor recommendations could not yet be assessed.'),
            };
    }
}

const useStyles = makeStyles({
    root: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalSNudge,
        position: 'relative',
    },
    focus: {
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThick,
        },
    },
    dot: {
        width: '6px',
        height: '6px',
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: 'currentColor',
    },
    tooltip: {
        maxWidth: 'min(480px, calc(100vw - 32px))',
        overflowWrap: 'anywhere',
    },
    checks: {
        margin: `${tokens.spacingVerticalS} 0`,
        paddingLeft: tokens.spacingHorizontalL,
        '& > li + li': { marginTop: tokens.spacingVerticalS },
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

export const AccountHealthStatus = ({
    provisioningState,
    accountHealth,
    healthChecks,
    activeAlertsUnavailable = false,
}: {
    provisioningState?: ProvisioningState;
    accountHealth?: HealthState;
    healthChecks?: OverviewHealthCheck[];
    activeAlertsUnavailable?: boolean;
}) => {
    const styles = useStyles();
    const health =
        HEALTH_LABELS[resolveAccountHealth(provisioningState, accountHealth, activeAlertsUnavailable) ?? 'Unknown'];
    const provisioning = provisioningHealthCheck(provisioningState);
    const checks = healthChecks ? [provisioning, ...healthChecks].map(describeCheck) : undefined;
    const scope = l10n.t(
        'Extension diagnostics, not Azure Resource Health. HTTP 5xx errors, availability, latency, storage limits, and index health are not assessed by this badge.',
    );
    const explanation = checks
        ? [...checks.map((check) => `${check.label} — ${CHECK_OUTCOMES[check.outcome]}. ${check.detail}`), scope].join(
              ' ',
          )
        : [
              provisioning.outcome === 'critical' || provisioning.outcome === 'warning'
                  ? describeCheck(provisioning).detail
                  : undefined,
              activeAlertsUnavailable
                  ? l10n.t('Active alerts could not be checked. Previously known problems are retained.')
                  : undefined,
          ]
              .filter(Boolean)
              .join(' ');
    return (
        <div className={styles.root}>
            <output className={styles.srOnly} aria-live="polite">
                {l10n.t('Account health: {status}', { status: health.label })}
            </output>
            <span>{l10n.t('Health:')}</span>
            <Tooltip
                content={
                    checks ? (
                        <div className={styles.tooltip}>
                            <strong>{l10n.t('Health: {health}', { health: health.label })}</strong>
                            <ul className={styles.checks}>
                                {checks.map((check) => (
                                    <li key={check.label}>
                                        <strong>{check.label}</strong>
                                        {' — '}
                                        {CHECK_OUTCOMES[check.outcome]}
                                        <div>{check.detail}</div>
                                    </li>
                                ))}
                            </ul>
                            <div>{scope}</div>
                        </div>
                    ) : (
                        explanation
                    )
                }
                relationship="description"
                visible={explanation ? undefined : false}
            >
                <Badge
                    appearance="tint"
                    shape="circular"
                    color={health.tone}
                    tabIndex={explanation ? 0 : undefined}
                    className={mergeClasses('focusableBadge', styles.focus)}
                    aria-label={health.label}
                    aria-description={explanation || undefined}
                    icon={<span className={styles.dot} aria-hidden />}
                >
                    <span aria-hidden>{health.label}</span>
                </Badge>
            </Tooltip>
        </div>
    );
};
