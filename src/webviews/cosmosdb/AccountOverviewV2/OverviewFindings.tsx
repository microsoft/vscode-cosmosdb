/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, useAnnounce } from '@fluentui/react-components';
import { Info16Regular, Warning16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useId, useRef } from 'react';
import { OverviewCoverage } from './OverviewCoverage';
import {
    findingSourceLabel,
    groupOverviewHealthFindings,
    type FindingSection,
    type OverviewFinding,
    type OverviewSummaryProps,
    overviewCategoryState,
    unavailableSummary,
} from './overviewFindingsModel';

type FindingDetailsProps = { overview: OverviewSummaryProps['overview']; section: FindingSection };

const useStyles = makeStyles({
    section: { minWidth: 0 },
    heading: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '12px', alignItems: 'center' },
    headingLabel: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' },
    title: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--vscode-foreground)' },
    subtitle: {
        color: 'var(--vscode-descriptionForeground)',
        margin: '4px 0 12px',
        lineHeight: '1.5',
        fontSize: '12px',
    },
    summaryDescription: { margin: 0 },
    subheading: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        margin: '4px 0 12px',
    },
    tableHeader: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px 16px',
        padding: '12px 16px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        backgroundColor: 'var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background))',
    },
    headerStatus: { margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 },
    headerDetails: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' },
    tableContainer: {
        minWidth: 0,
        margin: 0,
        padding: 0,
        overflowX: 'auto',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '8px',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        ':focus-visible': { outline: '1px solid var(--vscode-focusBorder)', outlineOffset: '2px' },
    },
    table: {
        width: '100%',
        minWidth: '560px',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        '& td, & th': {
            padding: '12px 16px',
            verticalAlign: 'top',
            textAlign: 'left',
            fontWeight: 400,
            overflowWrap: 'anywhere',
            borderBottom: '1px solid var(--vscode-panel-border)',
        },
        '& tr:last-child > td, & tr:last-child > th': { borderBottom: 0 },
    },
    severityColumn: { width: '120px' },
    actionColumn: { width: '34%' },
    healthTable: { minWidth: '800px' },
    resourceColumn: { width: '21%' },
    impactColumn: { width: '22%' },
    detailsColumn: { width: '110px' },
    cellLabel: {
        color: 'var(--vscode-descriptionForeground)',
        fontSize: '10px',
        textTransform: 'uppercase',
        margin: '0 0 4px',
    },
    resource: { margin: 0, fontSize: '12px', lineHeight: '1.5' },
    impact: { margin: 0, color: 'var(--vscode-charts-green)', fontSize: '12px', lineHeight: '1.5' },
    critical: { color: 'var(--vscode-errorForeground)' },
    warning: { color: 'var(--vscode-charts-yellow)' },
    informational: { color: 'var(--vscode-descriptionForeground)' },
    severity: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', fontWeight: 600 },
    itemTitle: { margin: '0 0 4px', fontSize: '12px', fontWeight: 600, color: 'var(--vscode-foreground)' },
    text: { margin: '6px 0', lineHeight: '1.5', fontSize: '12px' },
    evidence: { margin: 0, color: 'var(--vscode-descriptionForeground)', lineHeight: '1.5', fontSize: '12px' },
    provenance: {
        marginTop: '12px',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: '11px',
        lineHeight: '1.6',
        overflowWrap: 'anywhere',
    },
    controls: { display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end' },
    link: { color: 'var(--vscode-textLink-foreground)', fontSize: '12px' },
});

function HealthTableHeader({ overview }: Pick<OverviewSummaryProps, 'overview'>) {
    const styles = useStyles();
    const { findings, loading, partial } = overviewCategoryState(overview, 'findings');
    const critical = findings.filter((finding) => finding.priority === 0).length;
    const warnings = findings.filter((finding) => finding.priority > 0 && finding.priority < 3).length;
    const informational = findings.length - critical - warnings;
    const label = critical
        ? l10n.t('Critical attention required')
        : warnings
          ? l10n.t('Attention required')
          : informational
            ? l10n.t('Informational issues detected')
            : loading
              ? l10n.t('Checking account health…')
              : partial
                ? l10n.t('Health data incomplete')
                : l10n.t('No active issues detected');
    const counts = [
        findings.length === 1 ? l10n.t('1 active issue') : l10n.t('{count} active issues', { count: findings.length }),
        ...(critical ? [l10n.t('{count} critical', { count: critical })] : []),
        ...(warnings ? [warnings === 1 ? l10n.t('1 warning') : l10n.t('{count} warnings', { count: warnings })] : []),
        ...(informational ? [l10n.t('{count} informational', { count: informational })] : []),
    ];
    return (
        <div className={styles.tableHeader}>
            <p
                className={`${styles.headerStatus} ${critical ? styles.critical : warnings ? styles.warning : styles.informational}`}
            >
                {critical || warnings ? <Warning16Regular aria-hidden /> : <Info16Regular aria-hidden />}
                {label}
            </p>
            <div className={styles.headerDetails}>
                <OverviewCoverage overview={overview} section="findings" />
                <p
                    className={styles.evidence}
                    aria-description={l10n.t(
                        'Counts include individual issues from available sources, before grouping. Dismissed issues are excluded.',
                    )}
                >
                    {counts.join(' · ')}
                </p>
            </div>
        </div>
    );
}

function FindingsTable({
    overview,
    section,
    onInspect,
}: FindingDetailsProps & { onInspect?: OverviewSummaryProps['onInspect'] }) {
    const styles = useStyles();
    const { announce } = useAnnounce();
    const containerRef = useRef<HTMLFieldSetElement>(null);
    const { findings, loading, title, empty } = overviewCategoryState(overview, section);
    const compact = !!onInspect;
    const healthSummary = compact && section === 'findings';
    const rows = compact && section === 'findings' ? groupOverviewHealthFindings(findings) : findings;
    const visible = compact ? rows.slice(0, 3) : rows;
    const status =
        findings.length === 0
            ? empty
            : loading
              ? l10n.t('Updating; displayed findings are from the previous snapshot.')
              : l10n.t('{category}: {count} findings.', { category: title, count: findings.length });
    useEffect(() => {
        announce(status, { polite: true });
    }, [announce, status]);

    return (
        <>
            <fieldset
                ref={containerRef}
                className={styles.tableContainer}
                aria-label={title}
                // Keyboard users must be able to scroll the table horizontally.
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                aria-busy={loading}
            >
                {healthSummary && <HealthTableHeader overview={overview} />}
                <table className={`${styles.table} ${healthSummary ? styles.healthTable : ''}`} aria-label={title}>
                    <colgroup>
                        <col className={styles.severityColumn} />
                        <col />
                        {healthSummary && <col className={styles.resourceColumn} />}
                        {healthSummary && <col className={styles.impactColumn} />}
                        <col className={healthSummary ? styles.detailsColumn : styles.actionColumn} />
                    </colgroup>
                    <tbody>
                        {visible.map((finding: OverviewFinding) => (
                            <tr key={`${finding.source}:${finding.id}`}>
                                <td aria-label={l10n.t('Severity: {severity}', { severity: finding.severity })}>
                                    <span
                                        className={`${styles.severity} ${finding.priority === 0 ? styles.critical : finding.priority < 3 ? styles.warning : styles.informational}`}
                                    >
                                        {finding.priority < 3 ? (
                                            <Warning16Regular aria-hidden />
                                        ) : (
                                            <Info16Regular aria-hidden />
                                        )}
                                        {finding.severity}
                                    </span>
                                </td>
                                <th scope="row">
                                    <h3 className={styles.itemTitle}>{finding.title}</h3>
                                    <p className={styles.evidence}>{finding.rationale}</p>
                                    {compact && !healthSummary && (
                                        <p className={styles.provenance}>
                                            {l10n.t('Scope: {scope}', { scope: finding.scope })}
                                        </p>
                                    )}
                                    {!compact && (
                                        <div className={styles.provenance}>
                                            <div>
                                                {l10n.t('Source: {source}', {
                                                    source: findingSourceLabel(finding.source),
                                                })}
                                            </div>
                                            <div>{l10n.t('Scope: {scope}', { scope: finding.scope })}</div>
                                            {finding.threshold && <p className={styles.text}>{finding.threshold}</p>}
                                        </div>
                                    )}
                                </th>
                                {healthSummary && (
                                    <>
                                        <td>
                                            <p className={styles.cellLabel}>{l10n.t('Affected resource')}</p>
                                            <p className={styles.resource}>{finding.summaryScope ?? finding.scope}</p>
                                        </td>
                                        <td>
                                            <p className={styles.cellLabel}>{l10n.t('Estimated impact')}</p>
                                            <p className={finding.estimatedImpact ? styles.impact : styles.evidence}>
                                                {finding.estimatedImpact ?? l10n.t('Not estimated')}
                                            </p>
                                        </td>
                                    </>
                                )}
                                <td>
                                    {finding.action && <p className={styles.evidence}>{finding.action}</p>}
                                    {!healthSummary && finding.estimatedImpact && (
                                        <p className={styles.text}>
                                            {l10n.t('Estimated impact: {impact}', { impact: finding.estimatedImpact })}
                                        </p>
                                    )}
                                    {finding.benefit && (
                                        <p className={styles.text}>
                                            {l10n.t('Advisor-reported potential benefit: {benefit}', {
                                                benefit: finding.benefit,
                                            })}
                                        </p>
                                    )}
                                    <div className={styles.controls}>
                                        {onInspect ? (
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                className={styles.link}
                                                aria-description={finding.title}
                                                onClick={() => onInspect(section)}
                                            >
                                                {l10n.t('View details')}
                                            </Button>
                                        ) : (
                                            <>
                                                {finding.url && (
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        className={styles.link}
                                                        aria-description={finding.title}
                                                        onClick={() => overview.handleOpenUrl(finding.url!)}
                                                    >
                                                        {finding.source === 'alert'
                                                            ? l10n.t('Inspect Azure alert')
                                                            : l10n.t('Learn more')}
                                                    </Button>
                                                )}
                                                {finding.source === 'derived' && (
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        className={styles.link}
                                                        aria-description={l10n.t(
                                                            'Dismiss {title} for this session only.',
                                                            { title: finding.title },
                                                        )}
                                                        onClick={(event) => {
                                                            const row = event.currentTarget.closest('tr');
                                                            let nextRow = row?.nextElementSibling;
                                                            let nextAction: HTMLButtonElement | null = null;
                                                            while (nextRow && !nextAction) {
                                                                nextAction = nextRow.querySelector('button');
                                                                nextRow = nextRow.nextElementSibling;
                                                            }
                                                            (nextAction ?? containerRef.current)?.focus();
                                                            overview.handleDismissAdvisory(finding.id);
                                                            announce(l10n.t('Finding dismissed for this session.'), {
                                                                polite: true,
                                                            });
                                                        }}
                                                    >
                                                        {l10n.t('Dismiss')}
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {findings.length === 0 && <p className={styles.text}>{empty}</p>}
            </fieldset>
            {loading && findings.length > 0 && <p className={styles.subtitle}>{status}</p>}
            {compact && rows.length > 3 && (
                <p className={styles.subtitle}>
                    {section === 'findings'
                        ? l10n.t('Showing {shown} of {total} health groups.', { shown: 3, total: rows.length })
                        : l10n.t('Showing {shown} of {total} recommendations.', { shown: 3, total: rows.length })}
                </p>
            )}
        </>
    );
}

function FindingsSummary({ overview, onInspect, section }: OverviewSummaryProps & { section: FindingSection }) {
    const styles = useStyles();
    const headingId = useId();
    const health = section === 'findings';
    return (
        <section className={styles.section} aria-labelledby={headingId}>
            <div className={styles.heading}>
                <div className={styles.headingLabel}>
                    <h2 id={headingId} className={styles.title}>
                        {health ? l10n.t('Account health') : l10n.t('Prioritized recommendations')}
                    </h2>
                    {!health && <OverviewCoverage overview={overview} section={section} />}
                </div>
            </div>
            <div className={styles.subheading}>
                <p className={`${styles.subtitle} ${styles.summaryDescription}`}>
                    {health
                        ? l10n.t('Critical signals and warnings that may affect workload performance')
                        : l10n.t(
                              'Derived optimization opportunities and Azure Advisor guidance, ranked by importance.',
                          )}
                </p>
                <Button appearance="subtle" size="small" className={styles.link} onClick={() => onInspect(section)}>
                    {health ? l10n.t('View all alerts') : l10n.t('View all recommendations')}
                </Button>
            </div>
            <FindingsTable overview={overview} section={section} onInspect={onInspect} />
        </section>
    );
}

export function OverviewFindingDetails({ overview, section }: FindingDetailsProps) {
    const styles = useStyles();
    const { dismissedCount } = overviewCategoryState(overview, section);
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
        <div className={styles.section}>
            <FindingsTable overview={overview} section={section} />
            <div className={styles.provenance}>
                {section === 'findings' ? (
                    <div>
                        {l10n.t('Azure Monitor alerts ({window}): {status}', {
                            window: overview.alertTimeRange,
                            status:
                                overview.alerts && overview.alerts.timeRange !== overview.alertTimeRange
                                    ? l10n.t('Waiting for the selected alert window.')
                                    : sourceStatus(overview.alerts, overview.alertsLoading),
                        })}
                    </div>
                ) : (
                    <div>
                        {l10n.t('Azure Advisor: {status}', {
                            status: sourceStatus(overview.recommendations, overview.recommendationsLoading),
                        })}
                    </div>
                )}
                <div>
                    {l10n.t('Derived checks: {status}', {
                        status: sourceStatus(overview.derivedAdvisories, overview.derivedLoading),
                    })}
                </div>
                {section === 'findings' &&
                    overview.derivedAdvisories?.available &&
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
                <p className={styles.text}>
                    {section === 'findings'
                        ? l10n.t(
                              'Findings are account-wide and use source-specific lookbacks, not the chart scope or time window. Derived findings are not Azure alerts.',
                          )
                        : l10n.t(
                              'Derived opportunities and Azure Advisor guidance use source-specific lookbacks, not the chart scope or time window. Advisor guidance is account-associated; derived scopes are shown per finding.',
                          )}
                </p>
                {dismissedCount > 0 && (
                    <p className={styles.text}>
                        {l10n.t('{count} derived findings dismissed for this session.', {
                            count: dismissedCount,
                        })}
                    </p>
                )}
            </div>
        </div>
    );
}

export function OverviewFindings(props: OverviewSummaryProps) {
    return <FindingsSummary {...props} section="findings" />;
}

export function OverviewRecommendations(props: OverviewSummaryProps) {
    return <FindingsSummary {...props} section="recommendations" />;
}
