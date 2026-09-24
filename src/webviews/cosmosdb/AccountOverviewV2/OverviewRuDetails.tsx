/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import { Info16Filled, Warning16Filled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import {
    formatSummaryValue,
    rankResourceConsumers,
    rankResourcePeaks,
    summarizePartition,
} from './overviewMetricsModel';
import { normalizedRuIntervals } from './overviewRuDetailsModel';
import { OverviewThroughputDetailDialog, useThroughputDetailStyles } from './OverviewThroughputDetailDialog';
import { hasMeasurement, summarizeThroughput } from './overviewThroughputModel';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const useStyles = makeStyles({
    chart: { height: '250px', minWidth: 0, border: 0, padding: 0, margin: 0 },
});

function duration(ms: number | undefined): string {
    if (ms === undefined) {
        return l10n.t('Unavailable');
    }
    const minutes = Math.round(ms / 60_000);
    return minutes >= 60
        ? l10n.t('{hours}h {minutes}m', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
        : l10n.t('{minutes}m', { minutes });
}

export function OverviewRuDetails({
    overview,
    analytics,
    onClose,
    onReviewPartitions,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
    onClose: () => void;
    onReviewPartitions: () => void;
}) {
    const styles = { ...useThroughputDetailStyles(), ...useStyles() };
    const id = useId();
    const context = {
        timeRange: overview.timeRange,
        scope: overview.selectedContainer,
        loading: overview.trendsLoading,
        serverless: overview.summary?.isServerless,
    };
    const throughput = summarizeThroughput(
        overview.trends.normalizedRu,
        overview.trends.provisionedThroughput,
        analytics,
        context,
    );
    const series = overview.trends.normalizedRu;
    const intervals = hasMeasurement(throughput.normalized) && series ? normalizedRuIntervals(series) : undefined;
    const peaks = rankResourcePeaks(overview.inventoryMetrics, overview.timeRange);
    const resources = rankResourceConsumers(analytics, context, overview.inventoryMetrics, overview.inventory);
    const scope = overview.selectedContainer;
    const ranked = overview.trendsLoading
        ? []
        : peaks.rows
              .filter(
                  (row) =>
                      !scope ||
                      (row.databaseId === scope.databaseId &&
                          (!scope.containerId || row.containerId === scope.containerId)),
              )
              .slice(0, 3);
    const partition = summarizePartition(overview.partitionHealth, {
        container: overview.partitionContainer,
        mode: 'ru',
        timeRange: overview.timeRange,
        loading: overview.partitionLoading,
    });
    const partitionInScope =
        !scope ||
        (overview.partitionContainer?.databaseId === scope.databaseId &&
            (!scope.containerId || overview.partitionContainer?.containerId === scope.containerId));
    const showPartitions = partitionInScope && hasMeasurement(partition);
    const hot = showPartitions && overview.partitionHealth?.hotPartition;
    const scopeLabel = scope
        ? scope.containerId
            ? `${scope.databaseId} / ${scope.containerId}`
            : scope.databaseId
        : l10n.t('All databases');
    const rangeLabel = {
        '1H': l10n.t('last hour'),
        '24H': l10n.t('last 24 hours'),
        '7D': l10n.t('last 7 days'),
    }[overview.timeRange];
    const bucketNote = l10n.t(
        'Estimated from complete intervals whose maximum exceeds 80%, not continuous time above 80%. Missing and incomplete intervals are excluded.',
    );
    const peakLabel = { '1H': l10n.t('1-hour peak'), '24H': l10n.t('24-hour peak'), '7D': l10n.t('7-day peak') }[
        overview.timeRange
    ];
    const normalizedNote =
        throughput.normalizedTimestamp === undefined
            ? throughput.normalized.detail
            : l10n.t('Latest reported sample: {time}. Not an instantaneous current value.', {
                  time: new Date(throughput.normalizedTimestamp).toLocaleString(),
              });

    return (
        <OverviewThroughputDetailDialog
            title={l10n.t('Normalized RU Consumption')}
            subtitle={
                l10n.t('Maximum normalized throughput utilization across partition key ranges during the {range}.', {
                    range: rangeLabel,
                }) +
                ' ' +
                scopeLabel
            }
            busy={overview.trendsLoading || analytics.loading}
            onClose={onClose}
            onReviewPartitions={onReviewPartitions}
        >
            <dl className={styles.stats}>
                <div className={styles.stat}>
                    <dt>{l10n.t('Current')}</dt>
                    <dd aria-description={normalizedNote}>{formatSummaryValue(throughput.normalized)}</dd>
                </div>
                <div className={styles.stat}>
                    <dt>{peakLabel}</dt>
                    <dd>{formatSummaryValue(throughput.peak)}</dd>
                </div>
                <div className={styles.stat}>
                    <dt>{l10n.t('Time above 80% (estimated)')}</dt>
                    <dd aria-description={bucketNote}>{duration(intervals?.aboveMs)}</dd>
                </div>
                <div className={styles.stat}>
                    <dt>{l10n.t('429 throttling')}</dt>
                    <dd aria-description={throughput.throttling.detail}>{formatSummaryValue(throughput.throttling)}</dd>
                </div>
            </dl>
            <section className={styles.section} aria-labelledby={`${id}-recommendations`}>
                <h3 id={`${id}-recommendations`} className={styles.heading}>
                    {l10n.t('Recommendations')}
                </h3>
                <dl className={styles.guidance}>
                    <dt className={hot ? styles.warning : undefined}>
                        {hot ? <Warning16Filled aria-hidden /> : <Info16Filled className={styles.info} aria-hidden />}
                        {l10n.t('Review partition key distribution')}
                    </dt>
                    <dd>
                        {hot
                            ? l10n.t(
                                  'Physical-partition telemetry for {container} indicates saturation with headroom elsewhere. Review the partition key and workload distribution.',
                                  {
                                      container: `${overview.partitionContainer!.databaseId} / ${overview.partitionContainer!.containerId}`,
                                  },
                              )
                            : l10n.t(
                                  'Check for uneven utilization before increasing throughput. Aggregate normalized RU and 429 rates cannot identify a hot logical partition.',
                              )}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden />
                        {l10n.t('Confirm autoscale headroom')}
                    </dt>
                    <dd>
                        {hasMeasurement(throughput.autoscale)
                            ? l10n.t(
                                  'Latest reported autoscale maximum: {value}. This is not an account-wide capacity sum; physical partitions still have individual throughput limits.',
                                  { value: formatSummaryValue(throughput.autoscale) },
                              )
                            : throughput.autoscale.detail}
                    </dd>
                    <dt>
                        <Info16Filled className={styles.info} aria-hidden />
                        {l10n.t('Monitor sustained elevation')}
                    </dt>
                    <dd>
                        {l10n.t(
                            'Investigate if utilization remains above 80% or the 429 rate continues to rise. Check end-to-end latency, retry outcomes and partition distribution together.',
                        )}
                    </dd>
                </dl>
            </section>
            <section className={styles.section} aria-labelledby={`${id}-chart`}>
                <h3 id={`${id}-chart`} className={styles.heading}>
                    {l10n.t('Consumption over time')}
                </h3>
                {overview.trendsLoading ? (
                    <Spinner size="small" label={l10n.t('Loading trends…')} />
                ) : intervals?.points.length ? (
                    <fieldset
                        className={styles.chart}
                        aria-label={l10n.t('Normalized RU consumption chart')}
                        aria-describedby={`${id}-chart-guide`}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                                data={intervals.points}
                                accessibilityLayer
                                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                            >
                                <CartesianGrid vertical={false} stroke="var(--vscode-panel-border)" />
                                <XAxis
                                    dataKey="timestamp"
                                    type="number"
                                    domain={['dataMin', 'dataMax']}
                                    tickFormatter={(value: number) =>
                                        new Date(value).toLocaleString(
                                            undefined,
                                            overview.timeRange === '7D'
                                                ? { month: 'short', day: 'numeric' }
                                                : { hour: '2-digit', minute: '2-digit' },
                                        )
                                    }
                                    stroke="var(--vscode-descriptionForeground)"
                                    tick={{ fontSize: 10 }}
                                />
                                <YAxis
                                    domain={[0, 100]}
                                    ticks={[0, 50, 80, 100]}
                                    tickFormatter={(value: number) => `${value}%`}
                                    stroke="var(--vscode-descriptionForeground)"
                                    width={40}
                                    tick={{ fontSize: 10 }}
                                />
                                <ReferenceLine y={80} stroke="var(--vscode-charts-orange)" strokeDasharray="6 4" />
                                <Tooltip
                                    labelFormatter={(value) => new Date(Number(value)).toLocaleString()}
                                    formatter={(value) => [
                                        formatSummaryValue({ value: Number(value), unit: '%' }),
                                        l10n.t('Normalized RU'),
                                    ]}
                                    contentStyle={{
                                        background: 'var(--vscode-editorHoverWidget-background)',
                                        borderColor: 'var(--vscode-editorHoverWidget-border)',
                                        color: 'var(--vscode-editorHoverWidget-foreground)',
                                    }}
                                />
                                <Line
                                    dataKey="value"
                                    type="linear"
                                    stroke="var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))"
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls={false}
                                    isAnimationActive={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </fieldset>
                ) : (
                    <p className={styles.note}>
                        {intervals ? l10n.t('No complete intervals were reported.') : throughput.normalized.detail}
                    </p>
                )}
                <p id={`${id}-chart-guide`} className={styles.note}>
                    {l10n.t(
                        'Percentage scale from 0 to 100 with an 80% investigation guide. Use arrow keys to inspect reported intervals.',
                    )}
                </p>
                <p className={styles.note}>{normalizedNote}</p>
                <p className={styles.note}>
                    {bucketNote}
                    {intervals &&
                        ' ' +
                            l10n.t('Observed coverage: {observed} of {window}.', {
                                observed: duration(intervals.observedMs),
                                window: duration(intervals.windowMs),
                            })}
                </p>
                <p className={styles.note}>
                    {throughput.throttling.detail} {throughput.window}
                </p>
            </section>
            <section className={styles.section} aria-labelledby={`${id}-ranges`}>
                <h3 id={`${id}-ranges`} className={styles.heading}>
                    {l10n.t('Highest-utilization ranges')}
                </h3>
                <p className={styles.note}>
                    {l10n.t(
                        'Top reported containers by peak normalized RU. Logical partition-key values and per-key 429 rates are not available from these metrics.',
                    )}
                </p>
                {ranked.length > 0 ? (
                    <div className={styles.tableFrame}>
                        <table className={styles.table} aria-label={l10n.t('Highest-utilization containers')}>
                            <thead>
                                <tr>
                                    <th scope="col">{l10n.t('Database / container')}</th>
                                    <th scope="col">{l10n.t('Peak normalized RU')}</th>
                                    <th scope="col">{l10n.t('429 rate')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranked.map((row) => {
                                    const candidates = resources.rows.filter(
                                        (resource) =>
                                            resource.databaseId === row.databaseId &&
                                            resource.containerId === row.containerId,
                                    );
                                    const resource = candidates.length === 1 ? candidates[0] : undefined;
                                    return (
                                        <tr key={JSON.stringify([row.databaseId, row.containerId])}>
                                            <th scope="row">
                                                {row.databaseId} / {row.containerId}
                                            </th>
                                            <td className={styles.warning}>
                                                {formatSummaryValue({
                                                    value: row.peakRuPercent,
                                                    unit: '%',
                                                })}
                                            </td>
                                            <td aria-description={resource?.throttlingDetail}>
                                                {resource?.ratePercent === undefined
                                                    ? l10n.t('Unavailable')
                                                    : formatSummaryValue({
                                                          value: resource.ratePercent,
                                                          unit: '%',
                                                      })}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className={styles.note}>
                        {overview.trendsLoading
                            ? l10n.t('Updating selected scope and window…')
                            : peaks.rows.length
                              ? l10n.t('No reported containers match the selected scope.')
                              : peaks.detail}
                    </p>
                )}
                {ranked.length > 0 && <p className={styles.note}>{resources.detail}</p>}
                {showPartitions && (
                    <div className={styles.tableFrame}>
                        <p className={styles.note}>
                            {l10n.t(
                                'Physical partitions for {container}; p99 utilization, not period peak. Per-partition 429 rates are unavailable.',
                                {
                                    container: `${overview.partitionContainer!.databaseId} / ${overview.partitionContainer!.containerId}`,
                                },
                            )}
                        </p>
                        <table className={styles.table} aria-label={l10n.t('Highest-utilization physical partitions')}>
                            <thead>
                                <tr>
                                    <th scope="col">{l10n.t('Physical partition')}</th>
                                    <th scope="col">{l10n.t('p99 normalized RU')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {overview
                                    .partitionHealth!.tiles.filter(
                                        (tile) =>
                                            Number.isFinite(tile.sharePercent) &&
                                            tile.sharePercent >= 0 &&
                                            tile.sharePercent <= 100,
                                    )
                                    .slice()
                                    .sort((a, b) => b.sharePercent - a.sharePercent)
                                    .slice(0, 3)
                                    .map((tile) => (
                                        <tr key={tile.partitionId}>
                                            <th scope="row">{tile.partitionId}</th>
                                            <td className={styles.warning}>
                                                {formatSummaryValue({
                                                    value: tile.sharePercent,
                                                    unit: '%',
                                                })}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </OverviewThroughputDetailDialog>
    );
}
