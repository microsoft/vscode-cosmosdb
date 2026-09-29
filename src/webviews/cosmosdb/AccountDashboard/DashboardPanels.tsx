/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    Dropdown,
    MessageBar,
    MessageBarBody,
    Option,
    Skeleton,
    SkeletonItem,
    Table,
    TableBody,
    TableCell,
    TableCellActions,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    Tooltip,
} from '@fluentui/react-components';
import {
    DataHistogramRegular,
    DocumentSearchRegular,
    TableSimpleRegular,
    TextBulletListTreeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useState } from 'react';
import { type AlertTimeRange, type MetricKey, type PartitionDistributionMode } from '../../api/types';
import { EmptyState } from '../AccountOverview/DashboardChrome';
import { formatMetricValue, METRIC_ORDER, METRIC_VIEWS } from '../AccountOverview/metrics/descriptors';
import { MetricChart } from '../AccountOverview/metrics/MetricChart';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { type OverviewFinding } from '../AccountOverviewV2/overviewFindingsModel';
import {
    formatByteChange,
    rankResourceConsumers,
    rankResourcePeaks,
    summarizePartition,
} from '../AccountOverviewV2/overviewMetricsModel';
import { type OverviewAnalyticsState } from '../AccountOverviewV2/useOverviewAnalytics';
import { formatPercent, peakTone, scopeLabel, seriesValues, TIME_RANGE_LABELS } from './dashboardModel';
import {
    ChoiceGroup,
    DashboardMetric,
    FindingCard,
    NothingToFixCard,
    RelativeBar,
    SummaryCard,
} from './DashboardParts';

// ─── Metrics explorer ─────────────────────────────────────────────────────────────

/** Every Azure Monitor metric the host serves, one chart at a time, with the figures that summarize the window. */
export function MetricsExplorerPanel({
    overview,
    initialMetric = 'normalizedRu',
}: {
    overview: AccountOverviewState;
    initialMetric?: MetricKey;
}) {
    const [metric, setMetric] = useState<MetricKey>(initialMetric);
    const descriptor = METRIC_VIEWS[metric];
    const series = overview.trends[metric];
    const values = seriesValues(series);
    const average = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
    const pending = overview.trendsLoading && !series;
    const read = (value: number | undefined) =>
        pending
            ? undefined
            : series?.available && value !== undefined
              ? formatMetricValue(descriptor.unit, value)
              : null;

    return (
        <div className="tabPanel">
            <ChoiceGroup
                label={l10n.t('Metric')}
                value={metric}
                options={METRIC_ORDER.map((key) => [key, METRIC_VIEWS[key].label] as const)}
                onChange={setMetric}
            />
            <div className="twoColumn">
                <Card className="chartCard">
                    <div className="chartHeader">
                        <Text weight="semibold" size={400}>
                            {descriptor.label}
                        </Text>
                        <span className="panelCaption">
                            {scopeLabel(overview)} · {TIME_RANGE_LABELS[overview.timeRange]}
                        </span>
                    </div>
                    <MetricChart
                        descriptor={descriptor}
                        series={series}
                        loading={overview.trendsLoading}
                        timeRange={overview.timeRange}
                    />
                </Card>
                <SummaryCard title={l10n.t('Window summary')}>
                    <DashboardMetric
                        appearance="subtle"
                        size="small"
                        label={l10n.t('Peak')}
                        value={read(series?.peak)}
                    />
                    <DashboardMetric
                        appearance="subtle"
                        size="small"
                        label={l10n.t('Latest')}
                        value={read(values.at(-1))}
                    />
                    <DashboardMetric appearance="subtle" size="small" label={l10n.t('Average')} value={read(average)} />
                    <DashboardMetric
                        appearance="subtle"
                        size="small"
                        label={l10n.t('Samples')}
                        value={pending ? undefined : series?.available ? String(values.length) : null}
                        description={l10n.t('Reported intervals in the window. Missing intervals are gaps, not zeros.')}
                    />
                </SummaryCard>
            </div>
        </div>
    );
}

// ─── Partitions ─────────────────────────────────────────────────────────────────────

export function PartitionsPanel({ overview }: { overview: AccountOverviewState }) {
    const result = overview.partitionHealth;
    const container = overview.partitionContainer;
    const key = container ? `${container.databaseId}/${container.containerId}` : undefined;
    const summary = summarizePartition(result, {
        container,
        mode: overview.partitionMode,
        timeRange: overview.timeRange,
        loading: overview.partitionLoading,
    });
    const tiles = result?.available ? result.tiles.slice(0, 24) : [];
    const ruMode = overview.partitionMode === 'ru';

    return (
        <div className="tabPanel">
            <div className="panelToolbar">
                <Dropdown
                    size="small"
                    aria-label={l10n.t('Container')}
                    value={container ? `${container.databaseId} / ${container.containerId}` : ''}
                    selectedOptions={key ? [key] : []}
                    onOptionSelect={(_, data) => {
                        const next = overview.containers.find(
                            (item) => `${item.databaseId}/${item.containerId}` === data.optionValue,
                        );
                        if (next) {
                            overview.handleSelectPartitionContainer(next);
                        }
                    }}
                >
                    {overview.containers.map((item) => (
                        <Option
                            key={`${item.databaseId}/${item.containerId}`}
                            value={`${item.databaseId}/${item.containerId}`}
                            text={`${item.databaseId} / ${item.containerId}`}
                        >
                            {`${item.databaseId} / ${item.containerId}`}
                        </Option>
                    ))}
                </Dropdown>
                <ChoiceGroup<PartitionDistributionMode>
                    label={l10n.t('Distribution measure')}
                    value={overview.partitionMode}
                    options={[
                        ['ru', l10n.t('Request units')],
                        ['storage', l10n.t('Storage')],
                    ]}
                    onChange={overview.setPartitionMode}
                />
                <span className="panelToolbarEnd panelCaption">{TIME_RANGE_LABELS[overview.timeRange]}</span>
            </div>
            {!container ? (
                <EmptyState reason="noData" />
            ) : overview.partitionLoading && !result ? (
                <Skeleton aria-label={l10n.t('Loading partition distribution…')}>
                    <SkeletonItem size={120} />
                </Skeleton>
            ) : !result?.available ? (
                <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />
            ) : (
                <div className="twoColumn">
                    <Card>
                        <div className="chartHeader">
                            <Text weight="semibold" size={400}>
                                {ruMode
                                    ? l10n.t('Normalized RU by physical partition')
                                    : l10n.t('Storage share by physical partition')}
                            </Text>
                            <span className="panelCaption">{l10n.t('Busiest first, 0–100% scale')}</span>
                        </div>
                        <div
                            className="partitionBars"
                            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- composite bar chart
                            role="img"
                            aria-label={tiles
                                .map((tile) => `PKR-${tile.partitionId}: ${formatPercent(tile.sharePercent)}`)
                                .join('; ')}
                        >
                            {tiles.map((tile) => (
                                <Tooltip
                                    key={tile.partitionId}
                                    content={`PKR-${tile.partitionId} · ${formatPercent(tile.sharePercent, 1)}${tile.hot ? ` · ${l10n.t('Hot')}` : ''}`}
                                    relationship="description"
                                    withArrow
                                >
                                    <span
                                        className="partitionBar"
                                        data-hot={tile.hot}
                                        style={{ height: `${Math.max(2, Math.min(100, tile.sharePercent))}%` }}
                                    />
                                </Tooltip>
                            ))}
                        </div>
                        <div className="partitionAxis" aria-hidden="true">
                            {tiles.map((tile) => (
                                <span key={tile.partitionId}>{tile.partitionId}</span>
                            ))}
                        </div>
                    </Card>
                    <SummaryCard title={l10n.t('Distribution')}>
                        <DashboardMetric
                            appearance="subtle"
                            size="small"
                            label={ruMode ? l10n.t('Busiest partition') : l10n.t('Largest partition')}
                            value={formatPercent(summary.value, 1)}
                            description={summary.detail}
                        />
                        <DashboardMetric
                            appearance="subtle"
                            size="small"
                            label={l10n.t('Skew score')}
                            value={formatPercent(result.skewScore)}
                            description={l10n.t(
                                'Worst instantaneous share of the busiest partition over the window. Even distribution is close to 100% ÷ partitions.',
                            )}
                        />
                        <DashboardMetric
                            appearance="subtle"
                            size="small"
                            label={l10n.t('Physical partitions')}
                            value={String(result.partitionCount)}
                        />
                        <DashboardMetric
                            appearance="subtle"
                            size="small"
                            label={l10n.t('Hot partition')}
                            value={result.hotPartition ? l10n.t('Yes') : l10n.t('No')}
                            description={l10n.t(
                                'A partition is hot when it saturates while another partition has headroom.',
                            )}
                        />
                    </SummaryCard>
                </div>
            )}
        </div>
    );
}

// ─── Top consumers ───────────────────────────────────────────────────────────────────

export function TopConsumersPanel({
    overview,
    analytics,
    onInspectPartitions,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
    onInspectPartitions?: (databaseId: string, containerId: string) => void;
}) {
    const context = { timeRange: overview.timeRange, scope: overview.selectedContainer };
    const consumers = rankResourceConsumers(analytics, context, overview.inventoryMetrics, overview.inventory);
    const peaks = rankResourcePeaks(overview.inventoryMetrics, overview.timeRange);
    const useConsumers = consumers.state === 'ready' || consumers.state === 'partial';
    const rows = useConsumers
        ? consumers.rows.map((row) => ({
              databaseId: row.databaseId,
              containerId: row.containerId,
              peak: row.inventory?.peakRuPercent,
              consumed: row.peakBucketAverageRuPerSecond,
              rate: row.ratePercent,
              growth: row.inventory?.storageGrowthBytes,
          }))
        : peaks.rows.map((row) => ({
              databaseId: row.databaseId,
              containerId: row.containerId,
              peak: row.peakRuPercent,
              consumed: undefined,
              rate: undefined,
              growth: row.storageGrowthBytes,
          }));
    const largestConsumed = rows.reduce((max, row) => Math.max(max, row.consumed ?? 0), 0);
    const loading = analytics.loading && rows.length === 0;

    return (
        <div className="tabPanel">
            <div className="panelToolbar">
                <span className="panelCaption">
                    {useConsumers
                        ? l10n.t('{scope} · {window} · ranked by peak consumed RU/s', {
                              scope: scopeLabel(overview),
                              window: TIME_RANGE_LABELS[overview.timeRange],
                          })
                        : l10n.t('{window} · ranked by peak normalized RU', {
                              window: TIME_RANGE_LABELS[overview.timeRange],
                          })}
                </span>
            </div>
            {loading ? (
                <Skeleton aria-label={l10n.t('Loading resource consumption…')}>
                    {Array.from({ length: 4 }, (_, index) => (
                        <SkeletonItem key={index} size={24} style={{ marginBlock: 8 }} />
                    ))}
                </Skeleton>
            ) : rows.length === 0 ? (
                <output className="emptyState">
                    <span className="emptyStateDescription">{consumers.detail}</span>
                </output>
            ) : (
                <div className="tableScroller">
                    <Table size="small" className="dataTable" aria-label={l10n.t('Top RU consumers')}>
                        <colgroup>
                            <col className="colName" />
                            <col className="colBar" />
                            <col className="colSize" />
                            <col className="colNumber" />
                            <col className="colSize" />
                        </colgroup>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{l10n.t('Container')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Peak RU')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Consumed RU/s')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('429 rate')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Data · 7 days')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.slice(0, 10).map((row) => (
                                <TableRow key={`${row.databaseId}/${row.containerId}`} className="dataRow">
                                    <TableCell>
                                        <TableCellLayout
                                            truncate
                                            media={<TableSimpleRegular className="nameIcon" aria-hidden />}
                                            title={`${row.databaseId} / ${row.containerId}`}
                                        >
                                            {`${row.databaseId} / ${row.containerId}`}
                                        </TableCellLayout>
                                        <TableCellActions>
                                            <span className="rowActions">
                                                <Tooltip
                                                    content={l10n.t('Open Query Editor')}
                                                    relationship="label"
                                                    withArrow
                                                >
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<DocumentSearchRegular />}
                                                        onClick={() =>
                                                            overview.handleOpenQueryEditor(
                                                                row.databaseId,
                                                                row.containerId,
                                                            )
                                                        }
                                                    />
                                                </Tooltip>
                                                {onInspectPartitions && (
                                                    <Tooltip
                                                        content={l10n.t('Inspect partitions')}
                                                        relationship="label"
                                                        withArrow
                                                    >
                                                        <Button
                                                            appearance="subtle"
                                                            size="small"
                                                            icon={<DataHistogramRegular />}
                                                            onClick={() =>
                                                                onInspectPartitions(row.databaseId, row.containerId)
                                                            }
                                                        />
                                                    </Tooltip>
                                                )}
                                                <Tooltip
                                                    content={l10n.t('Reveal in tree')}
                                                    relationship="label"
                                                    withArrow
                                                >
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        icon={<TextBulletListTreeRegular />}
                                                        onClick={() =>
                                                            overview.handleRevealInTree(row.databaseId, row.containerId)
                                                        }
                                                    />
                                                </Tooltip>
                                            </span>
                                        </TableCellActions>
                                    </TableCell>
                                    <TableCell>
                                        <RelativeBar
                                            text={formatPercent(row.peak)}
                                            value={row.peak}
                                            maximum={100}
                                            tone={peakTone(row.peak)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <RelativeBar
                                            text={
                                                row.consumed === undefined
                                                    ? l10n.t('N/A')
                                                    : Math.round(row.consumed).toLocaleString()
                                            }
                                            value={row.consumed}
                                            maximum={largestConsumed}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <span className="numberCell">{formatPercent(row.rate, 2)}</span>
                                    </TableCell>
                                    <TableCell>
                                        <span className="numberCell">{formatByteChange(row.growth)}</span>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

// ─── Findings ──────────────────────────────────────────────────────────────────────

export function FindingList({
    overview,
    findings,
    loading,
    emptyTitle,
    emptyDescription,
    notice,
    onInspect,
    compact,
    limit,
}: {
    overview: AccountOverviewState;
    findings: OverviewFinding[];
    loading: boolean;
    emptyTitle: string;
    emptyDescription: string;
    notice?: ReactNode;
    onInspect?: (finding: OverviewFinding) => { label: string; run: () => void } | undefined;
    compact?: boolean;
    limit?: number;
}) {
    const visible = limit === undefined ? findings : findings.slice(0, limit);
    return (
        <div className="findingList">
            {notice}
            {loading && findings.length === 0 ? (
                <Skeleton aria-label={l10n.t('Loading findings…')}>
                    <SkeletonItem size={72} />
                </Skeleton>
            ) : findings.length === 0 ? (
                <NothingToFixCard title={emptyTitle} description={emptyDescription} />
            ) : (
                visible.map((finding) => {
                    const inspect = onInspect?.(finding);
                    return (
                        <FindingCard
                            key={`${finding.source}:${finding.id}`}
                            finding={finding}
                            compact={compact}
                            onOpenUrl={overview.handleOpenUrl}
                            onDismiss={overview.handleDismissAdvisory}
                            onInspect={inspect?.run}
                            inspectLabel={inspect?.label}
                        />
                    );
                })
            )}
        </div>
    );
}

/** Log Analytics-backed checks can be missing while metric-based checks still ran; say so, once. */
export function CoverageNotice({ overview }: { overview: AccountOverviewState }) {
    const logSource = overview.derivedAdvisories?.logSource;
    if (!logSource || logSource.available) {
        return null;
    }
    return (
        <MessageBar intent="info" layout="multiline">
            <MessageBarBody>
                {l10n.t(
                    'Log-based checks (cross-partition queries, partition-key alignment) did not run: diagnostic settings are not exporting to Log Analytics. Metric-based checks below are complete.',
                )}
            </MessageBarBody>
        </MessageBar>
    );
}

export const ALERT_WINDOWS: [AlertTimeRange, string][] = [
    ['1h', l10n.t('1 hour')],
    ['1d', l10n.t('1 day')],
    ['7d', l10n.t('7 days')],
    ['30d', l10n.t('30 days')],
];

export function AlertWindowPicker({ overview }: { overview: AccountOverviewState }) {
    return (
        <ChoiceGroup
            label={l10n.t('Alert window')}
            value={overview.alertTimeRange}
            options={ALERT_WINDOWS}
            onChange={overview.setAlertTimeRange}
        />
    );
}
