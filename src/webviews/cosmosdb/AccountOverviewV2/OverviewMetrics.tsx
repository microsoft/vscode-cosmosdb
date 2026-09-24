/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Popover, PopoverSurface, PopoverTrigger, useAnnounce } from '@fluentui/react-components';
import {
    Clock16Regular,
    DataHistogram16Regular,
    Database16Regular,
    Info16Regular,
    Shield16Regular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useId } from 'react';
import { type ContainerMetrics, type MetricKey } from '../../api/types';
import { OverviewBar } from './OverviewBar';
import { type OverviewSummaryProps, unavailableSummary } from './overviewFindingsModel';
import {
    formatByteChange,
    formatSummaryValue,
    isNonNegativeFinite,
    type MetricSummary,
    rankResourceConsumers,
    rankResourcePeaks,
    summarizeMetric,
    summarizePartition,
} from './overviewMetricsModel';
import { OverviewThroughput } from './OverviewThroughput';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    root: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '22px', minWidth: 0 },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: '14px',
        '@media (min-width: 521px) and (max-width: 960px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
        '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '8px',
        padding: '18px',
        minWidth: 0,
        overflowWrap: 'anywhere',
    },
    heading: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
    headingTitle: { display: 'flex', alignItems: 'center', gap: '4px' },
    info: { minWidth: 0, color: 'var(--vscode-descriptionForeground)' },
    measurementNotes: {
        maxWidth: '360px',
        fontSize: '12px',
        lineHeight: '1.5',
        '& > p': { margin: '8px 0' },
    },
    title: { fontSize: '14px', fontWeight: 600, margin: 0 },
    cardTitle: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600, margin: 0 },
    detail: { color: 'var(--vscode-descriptionForeground)', lineHeight: '1.5', margin: 0, fontSize: '11px' },
    subtitle: { color: 'var(--vscode-descriptionForeground)', margin: '4px 0 12px', fontSize: '12px' },
    statistic: { margin: 0 },
    label: { margin: 0, fontSize: '11px', lineHeight: '1.5', color: 'var(--vscode-descriptionForeground)' },
    value: {
        margin: '5px 0 0',
        fontSize: '26px',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: '1.3',
    },
    compactValue: { margin: 0, fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
    link: {
        minWidth: 0,
        padding: '2px 0',
        color: 'var(--vscode-textLink-foreground)',
        fontSize: '11px',
        textAlign: 'left',
    },
    footer: { marginTop: 'auto', paddingTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '8px' },
    pairs: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: '8px',
        margin: '4px 0',
        fontSize: '11px',
        '& dt': { color: 'var(--vscode-descriptionForeground)' },
        '& dd': { margin: 0, textAlign: 'right' },
    },
    details: {
        fontSize: '11px',
        lineHeight: '1.5',
        color: 'var(--vscode-descriptionForeground)',
        '& > summary': { cursor: 'pointer', color: 'var(--vscode-textLink-foreground)' },
        '& > p': { margin: '6px 0' },
    },
    tableFrame: { minWidth: 0, border: '1px solid var(--vscode-panel-border)', borderRadius: '8px', overflowX: 'auto' },
    table: {
        width: '100%',
        minWidth: '700px',
        borderCollapse: 'collapse',
        fontSize: '11px',
        backgroundColor: 'var(--vscode-sideBar-background, var(--vscode-editor-background))',
        '& th': { fontWeight: 400, color: 'var(--vscode-descriptionForeground)', textAlign: 'left' },
        '& th, & td': {
            padding: '9px 14px',
            borderBottom: '1px solid var(--vscode-panel-border)',
            verticalAlign: 'top',
        },
        '& tbody > tr:last-child > td': { borderBottom: 0 },
    },
    numeric: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
    resourceCell: {
        '& > details:not([open])': { display: 'inline-block', marginLeft: '8px' },
        '& > details[open]': { marginTop: '6px' },
    },
    utilization: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '110px', '& > div': { width: '70px' } },
    resourceActions: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' },
    partitions: { display: 'flex', alignItems: 'end', gap: '4px', height: '56px', margin: 0 },
    partitionBar: {
        flex: '1 1 0',
        minWidth: 0,
        backgroundColor: 'var(--vscode-charts-blue)',
        border: '1px solid var(--vscode-contrastBorder, transparent)',
        boxSizing: 'border-box',
    },
});

const ready = (summary: MetricSummary) => summary.state === 'ready' || summary.state === 'partial';
const validPercent = (value: number | undefined) => (isNonNegativeFinite(value) && value <= 100 ? value : undefined);

export function OverviewMetrics({
    overview,
    onInspect,
    analytics,
}: OverviewSummaryProps & { analytics?: OverviewAnalyticsState }) {
    const styles = useStyles();
    const id = useId();
    const { announce } = useAnnounce();
    const context = {
        timeRange: overview.timeRange,
        scope: overview.selectedContainer,
        loading: overview.trendsLoading,
    };
    const metric = (key: Parameters<typeof summarizeMetric>[0]) => summarizeMetric(key, overview.trends[key], context);
    const latency = metric('serverLatency');
    const storage = metric('dataIndexUsage');
    const availability = metric('serviceAvailability');
    const partition = summarizePartition(overview.partitionHealth, {
        container: overview.partitionContainer,
        mode: overview.partitionMode,
        timeRange: overview.timeRange,
        loading: overview.partitionLoading,
    });
    const consumers = analytics
        ? rankResourceConsumers(analytics, context, overview.inventoryMetrics, overview.inventory)
        : undefined;
    const peaks = rankResourcePeaks(overview.inventoryMetrics, overview.timeRange);
    const scope = overview.selectedContainer
        ? overview.selectedContainer.containerId
            ? `${overview.selectedContainer.databaseId} / ${overview.selectedContainer.containerId}`
            : l10n.t('Database {name}', { name: overview.selectedContainer.databaseId })
        : l10n.t('Account-wide');
    useEffect(() => {
        announce(l10n.t('Metric scope: {scope} · {window}', { scope, window: overview.timeRange }), { polite: true });
    }, [announce, scope, overview.timeRange]);

    const details = (label: string, content: ReactNode) => (
        <details className={styles.details}>
            <summary>{label}</summary>
            {content}
        </details>
    );
    const explanation = (summary: MetricSummary) =>
        ready(summary) ? (
            details(
                summary.state === 'partial'
                    ? l10n.t('Partial coverage · measurement details')
                    : l10n.t('Measurement details'),
                <p>{summary.detail}</p>,
            )
        ) : (
            <p className={styles.detail}>{summary.detail}</p>
        );
    const action = (label: string, target: Parameters<typeof onInspect>[0], metric?: MetricKey) => (
        <Button
            appearance="subtle"
            size="small"
            className={styles.link}
            onClick={() => (metric ? onInspect(target, metric) : onInspect(target))}
        >
            {label}
        </Button>
    );
    const resourceActions = (databaseId: string, containerId: string) => (
        <div className={styles.resourceActions}>
            <Button
                appearance="subtle"
                size="small"
                className={styles.link}
                aria-description={l10n.t('Container: {database} / {container}', {
                    database: databaseId,
                    container: containerId,
                })}
                onClick={() => overview.handleOpenQueryEditor(databaseId, containerId)}
            >
                {l10n.t('Open query editor')}
            </Button>
            <Button
                appearance="subtle"
                size="small"
                className={styles.link}
                onClick={() => overview.handleRevealInTree(databaseId, containerId)}
            >
                {l10n.t('Reveal in tree')}
            </Button>
            <Button
                appearance="subtle"
                size="small"
                className={styles.link}
                onClick={() => {
                    overview.handleSelectPartitionContainer({ databaseId, containerId });
                    onInspect('partition');
                }}
            >
                {l10n.t('Inspect partitions')}
            </Button>
        </div>
    );
    const resourceRow = (row: {
        databaseId: string;
        containerId: string;
        inventory?: ContainerMetrics;
        consumed?: number;
        rate?: number;
        detail: string;
    }) => {
        const peak = validPercent(row.inventory?.peakRuPercent);
        return (
            <tr key={JSON.stringify([row.databaseId, row.containerId])}>
                <td className={styles.resourceCell}>
                    <Button
                        appearance="subtle"
                        size="small"
                        className={styles.link}
                        aria-description={l10n.t('Open query editor')}
                        onClick={() => overview.handleOpenQueryEditor(row.databaseId, row.containerId)}
                    >
                        {row.databaseId} / {row.containerId}
                    </Button>
                    {details(
                        l10n.t('Resource details'),
                        <>
                            <p>{row.detail}</p>
                            {row.inventory ? (
                                <>
                                    <p>
                                        {l10n.t('Latest reported storage: {storage}', {
                                            storage: formatSummaryValue({
                                                value: row.inventory.storageBytes,
                                                unit: 'bytes',
                                            }),
                                        })}
                                    </p>
                                    <p>
                                        {l10n.t('Seven-day data change: {data}; index change: {index}', {
                                            data: formatByteChange(row.inventory.storageGrowthBytes),
                                            index: formatByteChange(row.inventory.indexGrowthBytes),
                                        })}
                                    </p>
                                </>
                            ) : (
                                <p>{l10n.t('Matching-window inventory metadata is unavailable for this resource.')}</p>
                            )}
                            {resourceActions(row.databaseId, row.containerId)}
                        </>,
                    )}
                </td>
                <td>
                    <div className={styles.utilization}>
                        {peak !== undefined && (
                            <OverviewBar value={peak} maximum={100} warning={row.inventory?.health !== 'Healthy'} />
                        )}
                        <span>{formatSummaryValue({ value: peak, unit: '%' })}</span>
                    </div>
                </td>
                <td className={styles.numeric}>{formatSummaryValue({ value: row.consumed, unit: 'RU/s' })}</td>
                <td className={styles.numeric}>{formatSummaryValue({ value: row.rate, unit: '%' })}</td>
                <td className={styles.numeric}>{formatByteChange(row.inventory?.storageGrowthBytes)}</td>
            </tr>
        );
    };
    const visibleTiles = ready(partition) ? (overview.partitionHealth?.tiles ?? []).slice(0, 12) : [];
    const querySource = overview.derivedAdvisories;
    const queryFindings = querySource?.advisories.filter(
        (finding) =>
            (finding.rule === 'CrossPartitionQuery' || finding.rule === 'ShardKeyMisalignment') &&
            !overview.dismissedAdvisoryIds.has(finding.id),
    );
    const queryDetail = overview.derivedLoading
        ? l10n.t('Updating log-based query findings…')
        : !querySource?.available
          ? unavailableSummary(querySource?.reason)
          : querySource.logSource?.available === false
            ? l10n.t('Query diagnostic coverage is incomplete: {reason}', {
                  reason: unavailableSummary(querySource.logSource.reason),
              })
            : l10n.t(
                  '{count} visible account-wide fan-out or partition-key findings. These are not slow-query counts.',
                  { count: queryFindings?.length ?? 0 },
              );

    return (
        <div className={styles.root}>
            <OverviewThroughput overview={overview} onInspect={onInspect} analytics={analytics} />
            <section aria-labelledby={`${id}-resources`}>
                <div className={styles.heading}>
                    <div className={styles.headingTitle}>
                        <h2 id={`${id}-resources`} className={styles.title}>
                            {consumers ? l10n.t('Top RU consumers') : l10n.t('Top resources by peak normalized RU')}
                        </h2>
                        <Popover withArrow>
                            <PopoverTrigger disableButtonEnhancement>
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    className={styles.info}
                                    icon={<Info16Regular aria-hidden />}
                                    aria-label={l10n.t('Resource measurement information')}
                                />
                            </PopoverTrigger>
                            <PopoverSurface
                                className={styles.measurementNotes}
                                aria-label={l10n.t('Resource measurement information')}
                            >
                                <p>{consumers?.detail ?? peaks.detail}</p>
                                {consumers?.windowStart !== undefined && consumers.windowEnd !== undefined && (
                                    <p>
                                        {l10n.t('Closed-bucket window: {start} to {end} (end exclusive).', {
                                            start: new Date(consumers.windowStart).toLocaleString(),
                                            end: new Date(consumers.windowEnd).toLocaleString(),
                                        })}
                                    </p>
                                )}
                                <p>
                                    {l10n.t('Showing {shown} of {count} containers.', {
                                        shown: Math.min(5, (consumers?.rows ?? peaks.rows).length),
                                        count: (consumers?.rows ?? peaks.rows).length,
                                    })}
                                </p>
                                <p>
                                    {l10n.t(
                                        'Resource peaks can occur at different times. Data change is first-to-last bytes over seven days, not percentage growth. Missing measurements are not zero.',
                                    )}
                                </p>
                            </PopoverSurface>
                        </Popover>
                    </div>
                    {action(l10n.t('View complete inventory'), 'inventory')}
                </div>
                <p className={styles.subtitle}>
                    {consumers
                        ? l10n.t('{scope} · {window} · ranked by peak bucket-average consumed RU/s.', {
                              scope,
                              window: overview.timeRange,
                          })
                        : l10n.t('Account-wide · {window} · ranked by saturation, not consumed RU or traffic share.', {
                              window: overview.timeRange,
                          })}
                </p>
                {(consumers?.state ?? peaks.state) !== 'ready' && (consumers?.rows ?? peaks.rows).length > 0 && (
                    <p className={styles.subtitle}>{consumers?.detail ?? peaks.detail}</p>
                )}
                <section
                    className={styles.tableFrame}
                    aria-label={l10n.t('Resource metrics table')}
                    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users must be able to scroll the table horizontally
                    tabIndex={0}
                >
                    <table className={styles.table} aria-labelledby={`${id}-resources`}>
                        <thead>
                            <tr>
                                <th scope="col">{l10n.t('Resource')}</th>
                                <th scope="col">{l10n.t('Peak normalized RU')}</th>
                                <th scope="col">{l10n.t('Consumed RU/s peak')}</th>
                                <th scope="col">{l10n.t('429 rate')}</th>
                                <th scope="col">{l10n.t('Data change · 7D')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {consumers
                                ? consumers.rows.slice(0, 5).map((row) =>
                                      resourceRow({
                                          ...row,
                                          consumed: row.peakBucketAverageRuPerSecond,
                                          rate: row.ratePercent,
                                          detail: row.throttlingDetail,
                                      }),
                                  )
                                : peaks.rows
                                      .slice(0, 5)
                                      .map((row) => resourceRow({ ...row, inventory: row, detail: peaks.detail }))}
                            {(consumers?.rows ?? peaks.rows).length === 0 && (
                                <tr>
                                    <td colSpan={5}>{consumers?.detail ?? peaks.detail}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </section>
            </section>
            <div className={styles.grid}>
                <section className={styles.card} aria-labelledby={`${id}-latency`}>
                    <h2 id={`${id}-latency`} className={styles.cardTitle}>
                        <Clock16Regular aria-hidden />
                        {l10n.t('Latency and queries')}
                    </h2>
                    <p className={styles.compactValue}>{formatSummaryValue(latency)}</p>
                    <p className={styles.label}>{l10n.t('Peak interval-average server latency')}</p>
                    {explanation(latency)}
                    {details(
                        overview.derivedLoading
                            ? l10n.t('Query diagnostics · updating')
                            : !querySource?.available || querySource.logSource?.available === false
                              ? l10n.t('Query diagnostics · incomplete coverage')
                              : l10n.t('Query diagnostics'),
                        <>
                            <p>{queryDetail}</p>
                            <p>{l10n.t('Worse of the available Direct/Gateway interval averages; not P99.')}</p>
                            {action(l10n.t('Inspect query findings'), 'findings')}
                        </>,
                    )}
                    <div className={styles.footer}>{action(l10n.t('Inspect latency'), 'metrics', 'serverLatency')}</div>
                </section>
                <section className={styles.card} aria-labelledby={`${id}-partition`}>
                    <h2 id={`${id}-partition`} className={styles.cardTitle}>
                        <DataHistogram16Regular aria-hidden />
                        {l10n.t('Partition skew')}
                    </h2>
                    <p className={styles.compactValue}>{formatSummaryValue(partition)}</p>
                    <p className={styles.label}>
                        {overview.partitionMode === 'ru'
                            ? l10n.t('Busiest partition p99 normalized RU')
                            : l10n.t('Largest physical partition storage share')}
                    </p>
                    {visibleTiles.length > 0 && (
                        <div
                            className={styles.partitions}
                            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- composite bar chart; a native img cannot contain the measured bars
                            role="img"
                            aria-label={visibleTiles
                                .map(
                                    (tile) =>
                                        `PKR-${tile.partitionId}: ${formatSummaryValue({ value: validPercent(tile.sharePercent), unit: '%' })}`,
                                )
                                .join('; ')}
                        >
                            {visibleTiles.map((tile) =>
                                validPercent(tile.sharePercent) !== undefined ? (
                                    <div
                                        key={tile.partitionId}
                                        className={styles.partitionBar}
                                        style={{
                                            height: `${tile.sharePercent}%`,
                                            ...(tile.hot ? { backgroundColor: 'var(--vscode-errorForeground)' } : {}),
                                        }}
                                    />
                                ) : (
                                    <span key={tile.partitionId}>—</span>
                                ),
                            )}
                        </div>
                    )}
                    {!ready(partition) && <p className={styles.detail}>{partition.detail}</p>}
                    {ready(partition) &&
                        details(
                            l10n.t('Partition measurements'),
                            <>
                                <p>{partition.detail}</p>
                                <p>
                                    {l10n.t('Container: {database} / {container} · {window}', {
                                        database: overview.partitionContainer!.databaseId,
                                        container: overview.partitionContainer!.containerId,
                                        window: overview.timeRange,
                                    })}
                                </p>
                                <p>
                                    {l10n.t('Showing {shown} of {count} physical partitions on a 0–100% scale.', {
                                        shown: visibleTiles.length,
                                        count: overview.partitionHealth!.partitionCount,
                                    })}
                                </p>
                                <ul>
                                    {visibleTiles.map((tile) => (
                                        <li key={tile.partitionId}>
                                            {`PKR-${tile.partitionId} — ${formatSummaryValue({ value: validPercent(tile.sharePercent), unit: '%' })}`}
                                            {tile.hot && ` · ${l10n.t('Flagged')}`}
                                        </li>
                                    ))}
                                </ul>
                            </>,
                        )}
                    <div className={styles.footer}>{action(l10n.t('Inspect partition distribution'), 'partition')}</div>
                </section>
                <section className={styles.card} aria-labelledby={`${id}-storage`}>
                    <h2 id={`${id}-storage`} className={styles.cardTitle}>
                        <Database16Regular aria-hidden />
                        {l10n.t('Storage and index')}
                    </h2>
                    <p className={styles.compactValue}>{formatSummaryValue(storage)}</p>
                    <p className={styles.label}>{l10n.t('Latest reported data + index storage')}</p>
                    <dl className={styles.pairs}>
                        <dt>{l10n.t('Document count')}</dt>
                        <dd>{formatSummaryValue(metric('documentCount'))}</dd>
                    </dl>
                    {explanation(storage)}
                    {details(
                        l10n.t('Storage coverage'),
                        <p>
                            {l10n.t(
                                'Reported data and index series are combined. The source does not certify that both series have samples in every interval. This snapshot is not index growth.',
                            )}
                        </p>,
                    )}
                    <div className={styles.footer}>{action(l10n.t('Inspect storage and indexing'), 'inventory')}</div>
                </section>
                <section className={styles.card} aria-labelledby={`${id}-availability`}>
                    <h2 id={`${id}-availability`} className={styles.cardTitle}>
                        <Shield16Regular aria-hidden />
                        {l10n.t('Availability and resilience')}
                    </h2>
                    <p className={styles.compactValue}>{formatSummaryValue(availability)}</p>
                    <p className={styles.label}>{l10n.t('Latest reported average availability')}</p>
                    <dl className={styles.pairs}>
                        <dt>{l10n.t('Regions')}</dt>
                        <dd>
                            {overview.summary
                                ? l10n.t('{read} read / {write} write', {
                                      read: overview.summary.readRegions.length,
                                      write: overview.summary.writeRegions.length,
                                  })
                                : l10n.t('Unknown')}
                        </dd>
                        <dt>{l10n.t('Automatic failover')}</dt>
                        <dd>
                            {overview.summary?.automaticFailoverEnabled === undefined
                                ? l10n.t('Unknown')
                                : overview.summary.automaticFailoverEnabled
                                  ? l10n.t('Enabled')
                                  : l10n.t('Disabled')}
                        </dd>
                    </dl>
                    {explanation(availability)}
                    {details(
                        l10n.t('Resilience coverage'),
                        <p>
                            {l10n.t(
                                'Availability is account-wide regardless of chart scope; latest reported hourly average, not an SLA or a period minimum. Region configuration is not measured resilience.',
                            )}
                        </p>,
                    )}
                    <div className={styles.footer}>
                        {action(l10n.t('Inspect availability'), 'metrics', 'serviceAvailability')}
                    </div>
                </section>
            </div>
        </div>
    );
}
