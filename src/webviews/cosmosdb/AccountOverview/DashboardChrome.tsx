/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, mergeClasses, Subtitle2, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type UnavailableReason } from '../../api/types';

/**
 * Shared visual chrome for the Account Overview dashboard: dark cards, section
 * titles, metric tiles, and pills. Every color is a `--vscode-*` token so the
 * layout tracks the active VS Code theme (dark, light, high-contrast).
 */

const useStyles = makeStyles({
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusLarge,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
        boxSizing: 'border-box',
        minWidth: 0,
    },
    sectionHeader: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    sectionTitleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    sectionTitle: {
        margin: 0,
    },
    sectionDescription: {
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
    metricTile: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
        minWidth: 0,
    },
    metricLabel: {
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
    },
    metricValue: {
        fontSize: tokens.fontSizeHero700,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: tokens.lineHeightHero700,
        overflowWrap: 'anywhere',
    },
    metricCaption: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
        overflowWrap: 'anywhere',
    },
    pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: tokens.borderRadiusCircular,
        fontSize: tokens.fontSizeBase200,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        color: 'var(--vscode-foreground)',
        whiteSpace: 'nowrap',
    },
    pillInfo: {
        border: '1px solid var(--vscode-focusBorder)',
        color: 'var(--vscode-textLink-foreground)',
    },
    pillSuccess: {
        border: '1px solid var(--vscode-charts-green, var(--vscode-testing-iconPassed))',
        color: 'var(--vscode-charts-green, var(--vscode-testing-iconPassed))',
    },
    pillWarning: {
        border: '1px solid var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))',
        color: 'var(--vscode-editorWarning-foreground)',
    },
    pillDanger: {
        border: '1px solid var(--vscode-errorForeground)',
        color: 'var(--vscode-errorForeground)',
    },
    emptyState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.spacingVerticalXS,
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
});

export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const DashboardCard = ({ className, children }: { className?: string; children: ReactNode }) => {
    const styles = useStyles();
    return <div className={mergeClasses(styles.card, className)}>{children}</div>;
};

export const SectionHeader = ({
    title,
    description,
    actions,
}: {
    title: string;
    description?: string;
    actions?: ReactNode;
}) => {
    const styles = useStyles();
    return (
        <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
                <Subtitle2 as="h2" className={styles.sectionTitle}>
                    {title}
                </Subtitle2>
                {actions}
            </div>
            {description && <Text className={styles.sectionDescription}>{description}</Text>}
        </div>
    );
};

export const MetricTile = ({
    label,
    value,
    caption,
    className,
}: {
    label: string;
    value: string;
    caption?: string;
    className?: string;
}) => {
    const styles = useStyles();
    return (
        <div className={mergeClasses(styles.metricTile, className)}>
            <Text className={styles.metricLabel}>{label}</Text>
            <Text className={styles.metricValue}>{value}</Text>
            {caption && <Text className={styles.metricCaption}>{caption}</Text>}
        </div>
    );
};

export const Pill = ({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) => {
    const styles = useStyles();
    const toneClass: Record<PillTone, string | undefined> = {
        neutral: undefined,
        info: styles.pillInfo,
        success: styles.pillSuccess,
        warning: styles.pillWarning,
        danger: styles.pillDanger,
    };
    return <span className={mergeClasses(styles.pill, toneClass[tone])}>{children}</span>;
};

// ─── Dashboard actions context ────────────────────────────────────────────────────
//
// A tiny context so shared chrome (e.g. EmptyState) can report telemetry and
// open external links without prop-drilling through every section. The default
// is a no-op so components remain usable outside a provider (tests, storybook).

export interface DashboardActions {
    /** Sends a webview telemetry event to the host (`common.reportEvent`). */
    reportEvent: (
        eventName: string,
        properties?: Record<string, string>,
        measurements?: Record<string, number>,
    ) => void;
    /** Opens an external URL in the user's browser via the host. */
    openUrl: (url: string) => void;
}

const noop = () => {
    /* no-op default */
};

const DashboardActionsContext = createContext<DashboardActions>({ reportEvent: noop, openUrl: noop });

export const DashboardActionsProvider = DashboardActionsContext.Provider;

export const useDashboardActions = (): DashboardActions => useContext(DashboardActionsContext);

/** Azure RBAC overview, linked from the "not enough permissions" empty-state. */
export const RBAC_LEARN_MORE_URL = 'https://learn.microsoft.com/azure/role-based-access-control/overview';

/** How to enable Cosmos DB diagnostic settings → Log Analytics, linked from the `logAnalyticsDisabled` notice. */
export const DIAGNOSTIC_SETTINGS_URL = 'https://learn.microsoft.com/azure/cosmos-db/monitor-resource-logs';

/**
 * Shared empty-state copy for every async section. Distinguishes an as-yet-empty telemetry pipeline
 * (`noData`) from an unsupported API/SKU (`unsupported`) and a missing Azure RBAC role (`rbac`),
 * so users never see a silent blank. For `rbac` it names the required role and links to the Azure
 * RBAC docs. Emits an `emptyStateShown` telemetry event once per reason.
 */
export const EmptyState = ({ reason, requiredRole }: { reason?: UnavailableReason; requiredRole?: string }) => {
    const styles = useStyles();
    const { reportEvent, openUrl } = useDashboardActions();

    useEffect(() => {
        if (reason) {
            reportEvent('emptyStateShown', { reason });
        }
    }, [reason, reportEvent]);

    let message: string;
    switch (reason) {
        case 'unsupported':
            message = l10n.t('Telemetry unavailable for this API or SKU.');
            break;
        case 'rbac':
            message = requiredRole
                ? l10n.t('Not enough permissions — your role is missing {0}.', requiredRole)
                : l10n.t('Not enough permissions to load this section.');
            break;
        case 'logAnalyticsDisabled':
            message = l10n.t('Enable diagnostic settings to a Log Analytics workspace to run log-based checks.');
            break;
        case 'noData':
        default:
            message = l10n.t('No telemetry for the selected time range.');
            break;
    }

    return (
        <output className={styles.emptyState}>
            <Text>{message}</Text>
            {reason === 'rbac' && (
                <Link as="button" onClick={() => openUrl(RBAC_LEARN_MORE_URL)}>
                    {l10n.t('Learn more about Azure roles')}
                </Link>
            )}
            {reason === 'logAnalyticsDisabled' && (
                <Link as="button" onClick={() => openUrl(DIAGNOSTIC_SETTINGS_URL)}>
                    {l10n.t('Learn how to enable diagnostic settings')}
                </Link>
            )}
        </output>
    );
};
