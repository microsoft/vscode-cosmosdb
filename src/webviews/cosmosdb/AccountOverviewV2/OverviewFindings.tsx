/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, useAnnounce } from '@fluentui/react-components';
import { Info16Regular, Warning16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useId, useRef } from 'react';
import {
    collectOverviewFindings,
    findingSourceLabel,
    type OverviewFinding,
    type OverviewSummaryProps,
    unavailableSummary,
} from './overviewFindingsModel';

const useStyles = makeStyles({
    root: { display: 'grid', gap: '20px', minWidth: 0 },
    section: { minWidth: 0 },
    heading: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px', alignItems: 'center' },
    title: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--vscode-foreground)' },
    subtitle: {
        color: 'var(--vscode-descriptionForeground)',
        margin: '4px 0 12px',
        lineHeight: '1.5',
        fontSize: '12px',
    },
    list: {
        listStyleType: 'none',
        padding: 0,
        margin: 0,
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        ':empty': { display: 'none' },
    },
    finding: {
        display: 'grid',
        gridTemplateColumns: '140px minmax(0, 1fr) auto',
        alignItems: 'start',
        gap: '12px',
        padding: '10px 16px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        overflowWrap: 'anywhere',
        ':last-child': { borderBottom: 0 },
        '@media (max-width: 640px)': { gridTemplateColumns: '1fr' },
    },
    critical: { color: 'var(--vscode-errorForeground)' },
    warning: { color: 'var(--vscode-charts-yellow)' },
    informational: { color: 'var(--vscode-descriptionForeground)' },
    severity: { display: 'flex', gap: '6px', alignItems: 'center', fontWeight: 600 },
    meta: { display: 'grid', gap: '4px', fontSize: '11px' },
    itemTitle: {
        display: 'inline',
        margin: '0 8px 4px 0',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--vscode-foreground)',
    },
    evidenceBody: { '&:has(details[open]) > p': { WebkitLineClamp: 'unset' } },
    text: { margin: '6px 0', lineHeight: '1.5', fontSize: '12px' },
    scope: { color: 'var(--vscode-descriptionForeground)', overflowWrap: 'anywhere', fontSize: '11px' },
    evidence: {
        margin: 0,
        color: 'var(--vscode-descriptionForeground)',
        fontSize: '11px',
        lineHeight: '1.5',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
    },
    controls: { display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end' },
    link: { color: 'var(--vscode-textLink-foreground)', fontSize: '11px' },
    disclosure: {
        display: 'inline-block',
        marginBottom: '4px',
        fontSize: '11px',
        '&[open]': { display: 'block' },
        '& > summary': { color: 'var(--vscode-textLink-foreground)', cursor: 'pointer', width: 'fit-content' },
        '& > summary:focus-visible': { outline: '1px solid var(--vscode-focusBorder)' },
    },
    coverage: {
        marginTop: '8px',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: '11px',
        lineHeight: '1.6',
        overflowWrap: 'anywhere',
        '& > summary': { cursor: 'pointer', width: 'fit-content' },
        '& > summary:focus-visible': { outline: '1px solid var(--vscode-focusBorder)' },
    },
});

function FindingsSummary({
    overview,
    onInspect,
    section,
}: OverviewSummaryProps & { section: 'health' | 'recommendations' }) {
    const styles = useStyles();
    const { announce } = useAnnounce();
    const initiallyAnnounced = useRef(false);
    const healthId = useId();
    const recommendationsId = useId();
    const findings = collectOverviewFindings(overview);
    const healthFindings = findings.filter((finding) => !finding.recommendation);
    const recommendations = findings.filter((finding) => finding.recommendation);
    const loading = overview.alertsLoading || overview.derivedLoading || overview.recommendationsLoading;
    const partial =
        !overview.alerts?.available ||
        overview.alerts.timeRange !== overview.alertTimeRange ||
        !overview.derivedAdvisories?.available ||
        overview.derivedAdvisories.logSource?.available === false ||
        !overview.recommendations?.available ||
        !overview.inventoryMetrics?.available;
    const status = loading
        ? l10n.t('Updating diagnostic coverage…')
        : findings.length > 0
          ? l10n.t('{count} findings from available sources', { count: findings.length }) +
            (partial ? ' · ' + l10n.t('Diagnostic coverage is incomplete.') : '')
          : partial
            ? l10n.t('No findings reported; diagnostic coverage is incomplete.')
            : l10n.t('No findings reported by available checks.');
    useEffect(() => {
        if (section === 'health' && !loading && !initiallyAnnounced.current) {
            initiallyAnnounced.current = true;
            announce(status, { polite: true });
        }
    }, [announce, loading, section, status]);

    const renderFinding = (finding: OverviewFinding) => (
        <li key={`${finding.source}:${finding.id}`} className={styles.finding}>
            <div className={styles.meta}>
                <span
                    className={`${styles.severity} ${finding.priority === 0 ? styles.critical : finding.priority < 3 ? styles.warning : styles.informational}`}
                >
                    {finding.priority < 3 ? <Warning16Regular aria-hidden /> : <Info16Regular aria-hidden />}
                    {finding.severity}
                </span>
                <span className={styles.scope}>{findingSourceLabel(finding.source)}</span>
            </div>
            <div className={styles.evidenceBody}>
                <h3 className={styles.itemTitle}>{finding.title}</h3>
                <details className={styles.disclosure}>
                    <summary>{l10n.t('Details')}</summary>
                    <div className={styles.scope}>{l10n.t('Scope: {scope}', { scope: finding.scope })}</div>
                    {finding.threshold && <p className={styles.scope}>{finding.threshold}</p>}
                    {finding.action && <p className={styles.text}>{finding.action}</p>}
                    {finding.benefit && (
                        <p className={styles.text}>
                            {l10n.t('Advisor-reported potential benefit: {benefit}', { benefit: finding.benefit })}
                        </p>
                    )}
                </details>
                <p className={styles.evidence}>{finding.rationale}</p>
            </div>
            <div className={styles.controls}>
                {finding.url && (
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        onClick={() => overview.handleOpenUrl(finding.url!)}
                    >
                        {finding.source === 'alert' ? l10n.t('Inspect Azure alert') : l10n.t('Learn more')}
                    </Button>
                )}
                {finding.source === 'derived' && (
                    <>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            onClick={() => onInspect('findings')}
                        >
                            {l10n.t('Inspect evidence')}
                        </Button>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            aria-description={l10n.t('Dismiss {title} for this session only.', {
                                title: finding.title,
                            })}
                            onClick={(event) => {
                                const item = event.currentTarget.closest('li');
                                const nextAction =
                                    item?.nextElementSibling?.querySelector('button') ??
                                    item?.closest('section')?.querySelector('button');
                                nextAction?.focus();
                                overview.handleDismissAdvisory(finding.id);
                                announce(l10n.t('Finding dismissed for this session.'), { polite: true });
                            }}
                        >
                            {l10n.t('Dismiss')}
                        </Button>
                    </>
                )}
            </div>
        </li>
    );
    const sourceStatus = (
        result: { available: boolean; reason?: Parameters<typeof unavailableSummary>[0] } | undefined,
        isLoading: boolean,
    ) =>
        isLoading
            ? l10n.t('Updating; any displayed findings are from the previous snapshot.')
            : result?.available
              ? l10n.t('Available')
              : result
                ? unavailableSummary(result.reason)
                : l10n.t('Not loaded.');

    return (
        <div className={styles.root}>
            {section === 'health' && (
                <section className={styles.section} aria-labelledby={healthId}>
                    <div className={styles.heading}>
                        <h2 id={healthId} className={styles.title}>
                            {l10n.t('Account health')}
                        </h2>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            onClick={() => onInspect('findings')}
                        >
                            {l10n.t('View all findings')}
                        </Button>
                    </div>
                    <p className={styles.subtitle}>
                        {status}
                        {overview.accountHealth && overview.accountHealth !== 'Healthy' && (
                            <span>
                                {' '}
                                ·{' '}
                                {l10n.t('Provisioning, throttling and Azure signals: {health}', {
                                    health:
                                        overview.accountHealth === 'Critical'
                                            ? l10n.t('Critical')
                                            : l10n.t('Needs Attention'),
                                })}
                            </span>
                        )}
                    </p>
                    <ul className={styles.list}>{healthFindings.slice(0, 3).map(renderFinding)}</ul>
                    {healthFindings.length === 0 && (
                        <p className={styles.text}>
                            {l10n.t(
                                'No active health findings to show. Missing or dismissed findings do not establish health.',
                            )}
                        </p>
                    )}
                    {healthFindings.length > 3 && (
                        <p className={styles.subtitle}>
                            {l10n.t('Showing {shown} of {total} health findings.', {
                                shown: 3,
                                total: healthFindings.length,
                            })}
                        </p>
                    )}
                    <details className={styles.coverage}>
                        <summary>{l10n.t('Diagnostic coverage')}</summary>
                        <div>
                            {l10n.t('Azure Monitor alerts ({window}): {status}', {
                                window: overview.alertTimeRange,
                                status:
                                    overview.alerts && overview.alerts.timeRange !== overview.alertTimeRange
                                        ? l10n.t('Waiting for the selected alert window.')
                                        : sourceStatus(overview.alerts, overview.alertsLoading),
                            })}
                        </div>
                        <div>
                            {l10n.t('Derived checks: {status}', {
                                status: sourceStatus(overview.derivedAdvisories, overview.derivedLoading),
                            })}
                        </div>
                        <div>
                            {l10n.t('Azure Advisor: {status}', {
                                status: sourceStatus(overview.recommendations, overview.recommendationsLoading),
                            })}
                        </div>
                        <div>
                            {l10n.t('Inventory telemetry: {status}', {
                                status: sourceStatus(overview.inventoryMetrics, false),
                            })}
                        </div>
                        {overview.derivedAdvisories?.available &&
                            overview.derivedAdvisories.logSource?.available === false && (
                                <div>
                                    {l10n.t('Partial coverage — log-based checks did not run: {reason}', {
                                        reason:
                                            overview.derivedAdvisories.logSource.reason === 'rbac'
                                                ? l10n.t('Log Analytics Reader access is missing.')
                                                : unavailableSummary(overview.derivedAdvisories.logSource.reason),
                                    })}
                                </div>
                            )}
                        <div>
                            {l10n.t(
                                'Findings are account-wide and use source-specific lookbacks, not the chart scope or time window. Derived findings are not Azure alerts.',
                            )}
                        </div>
                        {overview.dismissedAdvisoryIds.size > 0 && (
                            <div>
                                {l10n.t('{count} derived findings dismissed for this session.', {
                                    count: overview.dismissedAdvisoryIds.size,
                                })}
                            </div>
                        )}
                    </details>
                </section>
            )}
            {section === 'recommendations' && (
                <section className={styles.section} aria-labelledby={recommendationsId}>
                    <div className={styles.heading}>
                        <h2 id={recommendationsId} className={styles.title}>
                            {l10n.t('Prioritized recommendations')}
                        </h2>
                        <Button
                            appearance="subtle"
                            size="small"
                            className={styles.link}
                            onClick={() => onInspect('findings')}
                        >
                            {l10n.t('View all recommendations')}
                        </Button>
                    </div>
                    <p className={styles.subtitle}>
                        {l10n.t(
                            'Highest-impact opportunities first. Health findings above include their own recommended next steps.',
                        )}
                    </p>
                    <ul className={styles.list}>{recommendations.slice(0, 3).map(renderFinding)}</ul>
                    {recommendations.length === 0 && (
                        <p className={styles.text}>
                            {l10n.t(
                                'No recommendations reported by available sources. See diagnostic coverage in Account health.',
                            )}
                        </p>
                    )}
                    {recommendations.length > 3 && (
                        <p className={styles.subtitle}>
                            {l10n.t('Showing {shown} of {total} recommendations.', {
                                shown: 3,
                                total: recommendations.length,
                            })}
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}

export function OverviewFindings(props: OverviewSummaryProps) {
    return <FindingsSummary {...props} section="health" />;
}

export function OverviewRecommendations(props: OverviewSummaryProps) {
    return <FindingsSummary {...props} section="recommendations" />;
}
