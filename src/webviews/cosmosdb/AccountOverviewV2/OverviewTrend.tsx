/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type MetricKey, type MetricSeriesResult, type TimeRange } from '../../api/types';
import { formatMetricValue, METRIC_VIEWS } from '../AccountOverview/metrics/descriptors';
import { metricSamples, type MetricSummary } from './overviewMetricsModel';

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
    const points = ready && series ? metricSamples(series, descriptor.unit === 'percent') : [];
    const samples = points.filter((point) => point.value !== undefined);
    const peak = samples.reduce<number | undefined>(
        (maximum, point) => Math.max(maximum ?? point.value!, point.value!),
        undefined,
    );
    const first = points[0]?.timestamp;
    const last = points.at(-1)?.timestamp;
    const latestSample = samples.at(-1)?.timestamp;
    const duration = { '1H': 3_600_000, '24H': 86_400_000, '7D': 604_800_000 }[timeRange];
    const now = Date.now();
    const recent = latestSample !== undefined && latestSample <= now && now - latestSample < 60_000;
    const fullWindow = first !== undefined && Math.abs(now - first - duration) < 60_000;
    const startLabel =
        recent && fullWindow
            ? { '1H': l10n.t('1 hour ago'), '24H': l10n.t('24 hours ago'), '7D': l10n.t('7 days ago') }[timeRange]
            : l10n.t('First interval');
    const endLabel = recent && last === latestSample ? l10n.t('Now') : l10n.t('Last interval');

    return (
        <div className={styles.root}>
            {summary.state === 'loading' ? (
                <Spinner size="small" label={l10n.t('Loading trends…')} />
            ) : samples.length > 0 ? (
                <figure
                    style={{ height: 64, margin: 0 }}
                    aria-label={l10n.t('{0} trend', descriptor.label)}
                    aria-description={l10n.t(
                        '{0} over the selected window, peak {1}.',
                        descriptor.label,
                        formatMetricValue(descriptor.unit, peak),
                    )}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 8, left: 4 }} accessibilityLayer>
                            <XAxis
                                hide
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={['dataMin', 'dataMax']}
                            />
                            <YAxis hide domain={descriptor.yDomain === 'zeroTo100' ? [0, 100] : [0, 'auto']} />
                            <Tooltip
                                labelFormatter={(timestamp) => new Date(Number(timestamp)).toLocaleString()}
                                formatter={(value) => formatMetricValue(descriptor.unit, Number(value))}
                                contentStyle={{
                                    backgroundColor: 'var(--vscode-editorHoverWidget-background)',
                                    color: 'var(--vscode-editorHoverWidget-foreground)',
                                    borderColor: 'var(--vscode-editorHoverWidget-border)',
                                }}
                            />
                            <Line
                                type="linear"
                                dataKey="value"
                                name={descriptor.seriesLabel}
                                stroke="var(--vscode-charts-yellow, var(--vscode-textLink-foreground))"
                                strokeWidth={2}
                                dot={samples.length === 1 || samples.length !== points.length ? { r: 2 } : false}
                                isAnimationActive={false}
                                connectNulls={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </figure>
            ) : (
                <p className={styles.unavailable}>{summary.detail}</p>
            )}
            {samples.length > 0 && (
                <div className={styles.window}>
                    <span aria-description={new Date(first).toLocaleString()}>{startLabel}</span>
                    <span aria-description={new Date(last!).toLocaleString()}>{endLabel}</span>
                </div>
            )}
        </div>
    );
}
