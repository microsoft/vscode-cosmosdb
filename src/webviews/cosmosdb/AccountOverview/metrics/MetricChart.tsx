/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useMemo } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { type MetricPoint, type MetricSeriesResult, type TimeRange } from '../../../api/types';
import { EmptyState } from '../DashboardChrome';
import { formatAxisTick, formatMetricValue, type MetricViewDescriptor } from './descriptors';

// ─── Metric chart ───────────────────────────────────────────────────────────────
//
// One descriptor-driven line chart for the selected metric. Axis ticks, the Y
// domain, reference lines, and the tooltip all come from the metric's view
// descriptor + unit — there is no per-metric chart component. Sustained-throttling
// (429) windows are shaded when the series carries them (RU / requests providers).

const EMPTY_POINTS: MetricPoint[] = [];

const SERIES_COLOR = 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))';
const THROTTLE_COLOR = 'var(--vscode-errorForeground)';
const GRID_COLOR = 'var(--vscode-panel-border)';
const AXIS_COLOR = 'var(--vscode-descriptionForeground)';
const REFERENCE_COLOR = 'var(--vscode-charts-foreground, var(--vscode-descriptionForeground))';

const useStyles = makeStyles({
    chartArea: {
        position: 'relative',
        width: '100%',
        height: '280px',
    },
    emptyState: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '280px',
        color: 'var(--vscode-descriptionForeground)',
        textAlign: 'center',
    },
    tooltip: {
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border))',
        backgroundColor: 'var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))',
        color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))',
        fontSize: tokens.fontSizeBase200,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    throttleNote: {
        color: 'var(--vscode-errorForeground)',
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function formatTick(ts: number, timeRange: TimeRange): string {
    const d = new Date(ts);
    if (timeRange === '7D') {
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    }
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Collapses contiguous throttled points into `{ x1, x2 }` bands for ReferenceArea. */
function throttlingBands(points: readonly MetricPoint[]): { x1: number; x2: number }[] {
    const bands: { x1: number; x2: number }[] = [];
    let start: number | undefined;
    let prev: number | undefined;
    for (const p of points) {
        if (p.throttled) {
            if (start === undefined) {
                start = p.timestamp;
            }
            prev = p.timestamp;
        } else if (start !== undefined && prev !== undefined) {
            bands.push({ x1: start, x2: prev });
            start = undefined;
            prev = undefined;
        }
    }
    if (start !== undefined && prev !== undefined) {
        bands.push({ x1: start, x2: prev });
    }
    return bands;
}

interface ChartTooltipProps {
    active?: boolean;
    payload?: { payload: MetricPoint }[];
    descriptor: MetricViewDescriptor;
}

const ChartTooltip = ({ active, payload, descriptor }: ChartTooltipProps) => {
    const styles = useStyles();
    if (!active || !payload || payload.length === 0) {
        return null;
    }
    const point = payload[0].payload;
    return (
        <div className={styles.tooltip}>
            <Text weight="semibold">{formatTimestamp(point.timestamp)}</Text>
            <Text>{`${descriptor.seriesLabel}: ${formatMetricValue(descriptor.unit, point.value)}`}</Text>
            {point.throttled && (
                <Text className={styles.throttleNote}>{l10n.t('Sustained throttling (429s) in this window')}</Text>
            )}
        </div>
    );
};

export const MetricChart = ({
    descriptor,
    series,
    loading,
    timeRange,
}: {
    descriptor: MetricViewDescriptor;
    series?: MetricSeriesResult;
    loading: boolean;
    timeRange: TimeRange;
}) => {
    const styles = useStyles();

    const points = series?.points ?? EMPTY_POINTS;
    const bands = useMemo(() => throttlingBands(series?.points ?? EMPTY_POINTS), [series?.points]);

    const yDomain = useMemo<[number, number | 'auto']>(() => {
        if (descriptor.yDomain === 'zeroTo100') {
            const peak = series?.peak ?? 0;
            return [0, Math.max(100, Math.ceil(peak / 10) * 10)];
        }
        return [0, 'auto'];
    }, [descriptor.yDomain, series?.peak]);

    if (loading && points.length === 0) {
        return (
            <div className={styles.emptyState}>
                <Spinner size="small" label={l10n.t('Loading trends…')} />
            </div>
        );
    }

    if (!series?.available || points.length === 0) {
        return (
            <div className={styles.emptyState}>
                <EmptyState reason={series?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />
            </div>
        );
    }

    return (
        <figure className={styles.chartArea} style={{ margin: 0 }} aria-label={descriptor.label}>
            <figcaption className={styles.srOnly}>
                {l10n.t(
                    '{0} over the selected window, peak {1}.',
                    descriptor.label,
                    formatMetricValue(descriptor.unit, series.peak),
                )}
            </figcaption>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                    <XAxis
                        dataKey="timestamp"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(ts: number) => formatTick(ts, timeRange)}
                        stroke={AXIS_COLOR}
                        tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                    />
                    <YAxis
                        domain={yDomain}
                        tickFormatter={(v: number) => formatAxisTick(descriptor.unit, v)}
                        stroke={AXIS_COLOR}
                        tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                        width={52}
                    />
                    <Tooltip content={<ChartTooltip descriptor={descriptor} />} />
                    {bands.map((band) => (
                        <ReferenceArea
                            key={`${band.x1}-${band.x2}`}
                            x1={band.x1}
                            x2={band.x2}
                            fill={THROTTLE_COLOR}
                            fillOpacity={0.15}
                            ifOverflow="extendDomain"
                        />
                    ))}
                    {descriptor.referenceLines?.map((ref) => (
                        <ReferenceLine
                            key={ref.label}
                            y={ref.value}
                            stroke={REFERENCE_COLOR}
                            strokeDasharray="6 4"
                            label={{
                                value: ref.label,
                                position: 'insideTopRight',
                                fill: AXIS_COLOR,
                                fontSize: 11,
                            }}
                        />
                    ))}
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke={SERIES_COLOR}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                    />
                </LineChart>
            </ResponsiveContainer>
        </figure>
    );
};
