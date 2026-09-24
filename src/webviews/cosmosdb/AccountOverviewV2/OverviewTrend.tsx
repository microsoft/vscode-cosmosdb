/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type MetricKey, type MetricSeriesResult, type TimeRange } from '../../api/types';
import { METRIC_VIEWS } from '../AccountOverview/metrics/descriptors';
import { MetricChart } from '../AccountOverview/metrics/MetricChart';
import { isNonNegativeFinite, type MetricSummary } from './overviewMetricsModel';

const useStyles = makeStyles({
    root: { minWidth: 0 },
    window: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '11px',
        color: 'var(--vscode-descriptionForeground)',
    },
    unavailable: { color: 'var(--vscode-descriptionForeground)', fontSize: '12px' },
});

export function OverviewTrend({
    metric,
    series,
    summary,
    timeRange,
}: {
    metric: MetricKey;
    series?: MetricSeriesResult;
    summary: MetricSummary;
    timeRange: TimeRange;
}) {
    const styles = useStyles();
    const descriptor = METRIC_VIEWS[metric];
    const ready = summary.state === 'ready' || summary.state === 'partial';
    const points =
        ready && series
            ? series.points
                  .filter((point) => Number.isFinite(point.timestamp))
                  .map((point) => ({
                      ...point,
                      value:
                          isNonNegativeFinite(point.value) && (descriptor.unit !== 'percent' || point.value <= 100)
                              ? point.value
                              : undefined,
                  }))
                  .sort((a, b) => a.timestamp - b.timestamp)
            : [];
    const chartSeries =
        ready && series
            ? { ...series, points, peak: points.reduce((peak, point) => Math.max(peak, point.value ?? 0), 0) }
            : undefined;

    return (
        <div className={styles.root}>
            {summary.state === 'loading' ? (
                <Spinner size="small" label={l10n.t('Loading trends…')} />
            ) : chartSeries ? (
                <MetricChart
                    descriptor={descriptor}
                    series={chartSeries}
                    loading={false}
                    timeRange={timeRange}
                    connectNulls={false}
                    compact
                />
            ) : (
                <p className={styles.unavailable}>{summary.detail}</p>
            )}
            {chartSeries && points.length > 0 && (
                <div className={styles.window}>
                    <span>{new Date(points[0].timestamp).toLocaleString()}</span>
                    <span>{new Date(points[points.length - 1].timestamp).toLocaleString()}</span>
                </div>
            )}
        </div>
    );
}
