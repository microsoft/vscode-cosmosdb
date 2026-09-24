/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Popover, PopoverSurface, PopoverTrigger, useAnnounce } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect } from 'react';
import { type UnavailableReason } from '../../api/types';
import { DIAGNOSTIC_SETTINGS_URL, RBAC_LEARN_MORE_URL } from '../AccountOverview/DashboardChrome';
import { type OverviewSummaryProps, unavailableSummary } from './overviewFindingsModel';

type CoverageProps = {
    overview: Pick<
        OverviewSummaryProps['overview'],
        | 'alerts'
        | 'alertTimeRange'
        | 'alertsLoading'
        | 'derivedAdvisories'
        | 'derivedLoading'
        | 'recommendations'
        | 'recommendationsLoading'
        | 'handleOpenUrl'
        | 'refresh'
    >;
    section: 'findings' | 'recommendations';
};

interface CoverageNotice {
    source: string;
    label: string;
    description: string;
    action?: { label: string; url: string } | 'refresh';
}

const useStyles = makeStyles({
    root: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
    pill: {
        borderRadius: '999px',
        minHeight: '22px',
        padding: '0 8px',
        fontSize: '11px',
        color: 'var(--vscode-editorWarning-foreground)',
        backgroundColor: 'var(--vscode-inputValidation-warningBackground)',
        border: '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border))',
    },
    surface: {
        maxWidth: '360px',
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editorWidget-background)',
    },
    text: { margin: '0 0 8px', lineHeight: '1.5', fontSize: '12px' },
});

function sourceNotice(
    source: string,
    result: { available: boolean; reason?: UnavailableReason } | undefined,
    loading: boolean,
    requiredRole?: string,
): CoverageNotice | undefined {
    if (loading) {
        return {
            source,
            label: l10n.t('{source}: updating', { source }),
            description: l10n.t('Updating; any displayed findings are from the previous snapshot.'),
        };
    }
    if (result?.available) {
        return undefined;
    }
    if (!result) {
        return {
            source,
            label: l10n.t('{source}: not loaded', { source }),
            description: l10n.t('This source has not loaded. Findings from this source are not shown.'),
            action: 'refresh',
        };
    }
    switch (result.reason) {
        case 'rbac':
            return {
                source,
                label: l10n.t('{source}: missing access', { source }),
                description: requiredRole
                    ? l10n.t('Not enough permissions: your role is missing {0}.', requiredRole)
                    : l10n.t('Not enough permissions to load this section.'),
                action: { label: l10n.t('Learn more about Azure roles'), url: RBAC_LEARN_MORE_URL },
            };
        case 'logAnalyticsDisabled':
            return {
                source,
                label: l10n.t('{source}: logs disabled', { source }),
                description: l10n.t('Enable diagnostic settings to a Log Analytics workspace to run log-based checks.'),
                action: {
                    label: l10n.t('Learn how to enable diagnostic settings'),
                    url: DIAGNOSTIC_SETTINGS_URL,
                },
            };
        default:
            return {
                source,
                label:
                    result.reason === 'unsupported'
                        ? l10n.t('{source}: unsupported', { source })
                        : l10n.t('{source}: unavailable', { source }),
                description: unavailableSummary(result.reason),
                action: result.reason === 'unsupported' ? undefined : 'refresh',
            };
    }
}

export function OverviewCoverage({ overview: o, section }: CoverageProps) {
    const styles = useStyles();
    const { announce } = useAnnounce();
    const alertsCurrent = !o.alerts || o.alerts.timeRange === o.alertTimeRange;
    const notices = [
        section === 'findings'
            ? sourceNotice(
                  l10n.t('Azure alerts'),
                  alertsCurrent ? o.alerts : undefined,
                  o.alertsLoading,
                  l10n.t('Monitoring Reader'),
              )
            : sourceNotice(
                  l10n.t('Azure Advisor'),
                  o.recommendations,
                  o.recommendationsLoading,
                  l10n.t('Reader on the subscription'),
              ),
        sourceNotice(l10n.t('Derived checks'), o.derivedAdvisories, o.derivedLoading, l10n.t('Monitoring Reader')),
        section === 'findings' && o.derivedAdvisories?.available && o.derivedAdvisories.logSource?.available === false
            ? sourceNotice(
                  l10n.t('Log-based checks'),
                  o.derivedAdvisories.logSource,
                  o.derivedLoading,
                  l10n.t('Log Analytics Reader'),
              )
            : undefined,
    ].filter((notice): notice is CoverageNotice => notice !== undefined);
    const status = notices.map((notice) => `${notice.label}. ${notice.description}`).join(' ');
    useEffect(() => {
        if (status) {
            announce(status, { polite: true });
        }
    }, [announce, status]);

    return (
        <div className={styles.root}>
            {notices.map((notice) => (
                <Popover key={notice.source} openOnHover withArrow inline unstable_disableAutoFocus>
                    <PopoverTrigger disableButtonEnhancement>
                        <Button size="small" className={styles.pill} aria-description={notice.description}>
                            {notice.label}
                        </Button>
                    </PopoverTrigger>
                    <PopoverSurface className={styles.surface} aria-label={notice.label}>
                        <p className={styles.text}>{notice.description}</p>
                        {notice.action && (
                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                    if (notice.action === 'refresh') {
                                        o.refresh();
                                    } else if (notice.action) {
                                        o.handleOpenUrl(notice.action.url);
                                    }
                                }}
                            >
                                {notice.action === 'refresh' ? l10n.t('Refresh') : notice.action.label}
                            </Button>
                        )}
                    </PopoverSurface>
                </Popover>
            ))}
        </div>
    );
}
