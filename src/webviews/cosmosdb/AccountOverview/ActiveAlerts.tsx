/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    type BadgeProps,
    Card,
    Link,
    makeStyles,
    Spinner,
    Text,
    tokens,
    Toolbar,
    ToolbarToggleButton,
    typographyStyles,
    useAnnounce,
} from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useRef } from 'react';
import {
    type ActiveAlertSummary,
    type AlertItem,
    type AlertMonitorCondition,
    type AlertSeverity,
    type AlertsResult,
    type AlertTimeRange,
} from '../../api/types';
import { EmptyState, useDashboardActions } from './DashboardChrome';

/**
 * Localized labels for each alert time-range. Keyed by {@link AlertTimeRange} so the
 * compiler enforces that every range (derived from the backend `ALERT_TIME_RANGES`
 * source of truth) has a label here.
 */
const TIME_RANGE_LABELS: Record<AlertTimeRange, string> = {
    '1h': l10n.t('1h'),
    '1d': l10n.t('1d'),
    '7d': l10n.t('7d'),
    '30d': l10n.t('30d'),
};

/** Render order for the time-range filter buttons. */
const TIME_RANGES = Object.keys(TIME_RANGE_LABELS) as AlertTimeRange[];

const CONDITION_LABELS: Record<AlertMonitorCondition, string> = {
    Fired: l10n.t('Active'),
    Resolved: l10n.t('Resolved'),
};
const MONITOR_CONDITIONS = Object.keys(CONDITION_LABELS) as AlertMonitorCondition[];

const SEVERITY_TONE: Record<AlertSeverity, BadgeProps['color']> = {
    Critical: 'danger',
    Warning: 'warning',
    Informational: 'subtle',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    filters: {
        flexWrap: 'wrap',
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    item: {
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
        overflow: 'visible',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    title: {
        ...typographyStyles.body1Strong,
        overflowWrap: 'anywhere',
        minWidth: 0,
    },
    meta: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
        overflowWrap: 'anywhere',
    },
    link: {
        ...typographyStyles.body1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
    },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        padding: tokens.spacingVerticalL,
    },
});

function formatStartedAt(startedAt: number | undefined): string | undefined {
    if (startedAt === undefined) {
        return undefined;
    }
    const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60_000));
    if (minutes < 60) {
        return l10n.t('Fired {minutes}m ago', { minutes });
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return l10n.t('Fired {hours}h ago', { hours });
    }
    return l10n.t('Fired {days}d ago', { days: Math.round(hours / 24) });
}

function severityLabel(severity: AlertSeverity): string {
    switch (severity) {
        case 'Critical':
            return l10n.t('Critical');
        case 'Warning':
            return l10n.t('Warning');
        case 'Informational':
            return l10n.t('Informational');
    }
}

const AlertRow = ({ alert, onOpenUrl }: { alert: AlertItem; onOpenUrl: (url: string) => void }) => {
    const styles = useStyles();
    const started = formatStartedAt(alert.startedAt);
    return (
        <Card className={styles.item} appearance="outline" focusMode="off">
            <div className={styles.titleRow}>
                <Text className={styles.title}>{alert.name}</Text>
                <Badge appearance="outline" shape="circular" color={SEVERITY_TONE[alert.severity]}>
                    {severityLabel(alert.severity)}
                </Badge>
            </div>
            {(alert.alertRule || started) && (
                <Text className={styles.meta}>{[alert.alertRule, started].filter(Boolean).join(' · ')}</Text>
            )}
            <Link
                className={styles.link}
                as="button"
                onClick={() => onOpenUrl(alert.portalUrl)}
                aria-description={l10n.t('View alert {name} in the Azure portal', { name: alert.name })}
            >
                <Open16Regular aria-hidden />
                {l10n.t('View in Azure portal')}
            </Link>
        </Card>
    );
};

export const ActiveAlerts = ({
    result,
    portalUrl,
    activeSummary,
    activeSummaryLoading = false,
    activeSummaryUnavailable = false,
    loading,
    timeRange,
    monitorCondition,
    onTimeRangeChange,
    onMonitorConditionChange,
    onOpenUrl,
    active = true,
}: {
    result?: AlertsResult;
    portalUrl?: string;
    activeSummary?: ActiveAlertSummary;
    activeSummaryLoading?: boolean;
    activeSummaryUnavailable?: boolean;
    loading: boolean;
    timeRange: AlertTimeRange;
    monitorCondition: AlertMonitorCondition;
    onTimeRangeChange: (range: AlertTimeRange) => void;
    onMonitorConditionChange: (condition: AlertMonitorCondition) => void;
    onOpenUrl: (url: string) => void;
    active?: boolean;
}) => {
    const styles = useStyles();
    const { reportEvent } = useDashboardActions();
    const { announce } = useAnnounce();
    const pendingFilter = useRef<{ timeRange: AlertTimeRange; monitorCondition: AlertMonitorCondition } | undefined>(
        undefined,
    );

    useEffect(() => {
        if (!active) {
            pendingFilter.current = undefined;
        }
        if (
            loading ||
            !pendingFilter.current ||
            result?.timeRange !== pendingFilter.current.timeRange ||
            result?.monitorCondition !== pendingFilter.current.monitorCondition
        ) {
            return;
        }
        pendingFilter.current = undefined;
        announce(
            result.available
                ? result.monitorCondition === 'Fired'
                    ? l10n.t('Active alerts in the selected window: {count}', { count: result.alerts.length })
                    : l10n.t('Resolved alerts in the selected window: {count}', { count: result.alerts.length })
                : result.monitorCondition === 'Fired'
                  ? l10n.t('Active alerts could not be loaded for the selected window.')
                  : l10n.t('Resolved alerts could not be loaded for the selected window.'),
            { polite: true },
        );
    }, [active, loading, result, announce]);

    const openAlert = (url: string) => {
        reportEvent('deepLinkFollowed', { target: 'portal' });
        onOpenUrl(url);
    };

    const filters = (
        <Toolbar
            className={styles.filters}
            size="small"
            aria-label={l10n.t('Alert time range')}
            checkedValues={{ timeRange: [timeRange] }}
        >
            {TIME_RANGES.map((range) => (
                <ToolbarToggleButton
                    key={range}
                    name="timeRange"
                    value={range}
                    disabled={loading}
                    disabledFocusable={loading}
                    aria-description={loading ? l10n.t('Alerts are still loading.') : undefined}
                    onClick={
                        loading
                            ? undefined
                            : () => {
                                  if (range !== timeRange) {
                                      pendingFilter.current = { timeRange: range, monitorCondition };
                                      onTimeRangeChange(range);
                                  }
                              }
                    }
                >
                    {TIME_RANGE_LABELS[range]}
                </ToolbarToggleButton>
            ))}
        </Toolbar>
    );

    let body: ReactNode;
    if (loading) {
        body = (
            <div className={styles.loading}>
                <Spinner
                    size="small"
                    label={
                        monitorCondition === 'Fired'
                            ? l10n.t('Loading active alerts…')
                            : l10n.t('Loading resolved alerts…')
                    }
                />
            </div>
        );
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else if (result.alerts.length === 0) {
        body = (
            <Text className={styles.emptyState}>
                {monitorCondition === 'Fired'
                    ? l10n.t('No active alerts in the selected window.')
                    : l10n.t('No resolved alerts in the selected window.')}
            </Text>
        );
    } else {
        body = (
            <div className={styles.list}>
                {result.alerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onOpenUrl={openAlert} />
                ))}
            </div>
        );
    }

    return (
        <div className={styles.root}>
            <output aria-live="polite" aria-atomic="true">
                {activeSummaryLoading ? (
                    <Text>{l10n.t('Checking all active alerts…')}</Text>
                ) : activeSummaryUnavailable || !activeSummary?.available ? (
                    <Text>
                        {l10n.t(
                            'The account-wide active alert check is unavailable. The filtered list is shown below.',
                        )}
                    </Text>
                ) : (
                    <Text>
                        {l10n.t('Active alerts for this account: {total} ({critical} critical, {warning} warning).', {
                            total: activeSummary.totalCount,
                            critical: activeSummary.criticalCount,
                            warning: activeSummary.warningCount,
                        })}{' '}
                        {l10n.t(
                            'This count covers all Fired alerts retained in Azure Resource Graph, regardless of the filters below. Older active alerts may be outside the selected list period.',
                        )}
                    </Text>
                )}
            </output>
            {portalUrl && (
                <Link
                    className={styles.link}
                    href={portalUrl}
                    aria-description={l10n.t(
                        'Opens Azure Monitor alerts for this account. The portal has its own time and condition filters.',
                    )}
                    onClick={(event) => {
                        event.preventDefault();
                        openAlert(portalUrl);
                    }}
                >
                    <Open16Regular aria-hidden />
                    {l10n.t('Open alerts in Azure portal')}
                </Link>
            )}
            <Toolbar
                className={styles.filters}
                size="small"
                aria-label={l10n.t('Alert monitor condition')}
                checkedValues={{ monitorCondition: [monitorCondition] }}
            >
                {MONITOR_CONDITIONS.map((condition) => (
                    <ToolbarToggleButton
                        key={condition}
                        name="monitorCondition"
                        value={condition}
                        disabled={loading}
                        disabledFocusable={loading}
                        aria-description={loading ? l10n.t('Alerts are still loading.') : undefined}
                        onClick={
                            loading
                                ? undefined
                                : () => {
                                      if (condition !== monitorCondition) {
                                          pendingFilter.current = { timeRange, monitorCondition: condition };
                                          onMonitorConditionChange(condition);
                                      }
                                  }
                        }
                    >
                        {CONDITION_LABELS[condition]}
                    </ToolbarToggleButton>
                ))}
            </Toolbar>
            {filters}
            {body}
        </div>
    );
};
