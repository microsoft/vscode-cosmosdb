/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, mergeClasses, Spinner, Text, tokens } from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import { type AlertItem, type AlertSeverity, type AlertsResult, type AlertTimeRange } from '../../api/types';
import { EmptyState, Pill, type PillTone, useDashboardActions } from './DashboardChrome';

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

const SEVERITY_TONE: Record<AlertSeverity, PillTone> = {
    Critical: 'danger',
    Warning: 'warning',
    Informational: 'neutral',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    filters: {
        display: 'flex',
        gap: tokens.spacingHorizontalXS,
        flexWrap: 'wrap',
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    item: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    itemInformational: {
        opacity: 0.75,
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    meta: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    link: {
        fontSize: tokens.fontSizeBase200,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
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
        <div className={mergeClasses(styles.item, alert.severity === 'Informational' && styles.itemInformational)}>
            <div className={styles.titleRow}>
                <Text className={styles.title} title={alert.name}>
                    {alert.name}
                </Text>
                <Pill tone={SEVERITY_TONE[alert.severity]}>{severityLabel(alert.severity)}</Pill>
            </div>
            {(alert.alertRule || started) && (
                <Text className={styles.meta}>{[alert.alertRule, started].filter(Boolean).join(' · ')}</Text>
            )}
            <Link
                className={styles.link}
                as="button"
                onClick={() => onOpenUrl(alert.portalUrl)}
                aria-label={l10n.t('View alert {name} in the Azure portal', { name: alert.name })}
            >
                <Open16Regular />
                {l10n.t('View in Azure portal')}
            </Link>
        </div>
    );
};

export const ActiveAlerts = ({
    result,
    loading,
    timeRange,
    onTimeRangeChange,
    onOpenUrl,
}: {
    result?: AlertsResult;
    loading: boolean;
    timeRange: AlertTimeRange;
    onTimeRangeChange: (range: AlertTimeRange) => void;
    onOpenUrl: (url: string) => void;
}) => {
    const styles = useStyles();
    const { reportEvent } = useDashboardActions();

    const openAlert = (url: string) => {
        reportEvent('deepLinkFollowed', { target: 'portal' });
        onOpenUrl(url);
    };

    const filters = (
        <div className={styles.filters} role="toolbar" aria-label={l10n.t('Alert time range')}>
            {TIME_RANGES.map((range) => (
                <Button
                    key={range}
                    size="small"
                    appearance={timeRange === range ? 'primary' : 'subtle'}
                    aria-pressed={timeRange === range}
                    onClick={() => onTimeRangeChange(range)}
                >
                    {TIME_RANGE_LABELS[range]}
                </Button>
            ))}
        </div>
    );

    let body: ReactNode;
    if (loading && !result) {
        body = (
            <div className={styles.loading}>
                <Spinner size="small" label={l10n.t('Loading alerts…')} />
            </div>
        );
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else if (result.alerts.length === 0) {
        body = <Text className={styles.emptyState}>{l10n.t('No active alerts in the selected window.')}</Text>;
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
            {filters}
            {body}
        </div>
    );
};
