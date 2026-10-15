/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Card,
    Link,
    makeStyles,
    mergeClasses,
    Subtitle2,
    Text,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type UnavailableReason } from '../../api/types';

/**
 * Shared visual chrome for the Account Overview dashboard: cards, section titles, and empty states.
 * Fluent components and VS Code theme tokens keep the layout aligned with the active theme.
 */

const useStyles = makeStyles({
    card: {
        gap: tokens.spacingVerticalM,
        minWidth: 0,
        overflow: 'visible',
    },
    sectionHeader: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
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
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    emptyState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.spacingVerticalXS,
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
    },
});

export const DashboardCard = ({ className, children }: { className?: string; children: ReactNode }) => {
    const styles = useStyles();
    return (
        <Card className={mergeClasses(styles.card, className)} size="large" appearance="outline" focusMode="off">
            {children}
        </Card>
    );
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
    showOutput: () => void;
}

const noop = () => {
    /* no-op default */
};

const DashboardActionsContext = createContext<DashboardActions>({ reportEvent: noop, openUrl: noop, showOutput: noop });

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
                ? l10n.t('Not enough permissions: your role is missing {0}.', requiredRole)
                : l10n.t('Not enough permissions to load this section.');
            break;
        case 'logAnalyticsDisabled':
            message = l10n.t(
                'Required log tables are unavailable. Check diagnostic categories, resource-specific export mode, ingestion, and Log Analytics access.',
            );
            break;
        case 'noData':
        default:
            message = l10n.t('No telemetry available for this selection yet.');
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
