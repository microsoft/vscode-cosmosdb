/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Spinner, Text, tokens, typographyStyles } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useMemo } from 'react';
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { summarizeStorage } from '../../../../panels/accountOverview/metrics/storage';
import {
    type MetricApplicability,
    type MetricPoint,
    type MetricSeriesResult,
    type TimeRange,
} from '../../../api/types';
import { useThemedTooltipClassName } from '../../../common/ThemedTooltip';
import { EmptyState } from '../DashboardChrome';
import {
    formatAxisTick,
    formatMetricValue,
    metricInapplicabilityExplanation,
    storageDescription,
    storageObservationLabel,
    type MetricViewDescriptor,
} from './descriptors';

// ─── Metric chart ───────────────────────────────────────────────────────────────
//
// One descriptor-driven line chart for the selected metric. Axis ticks, the Y
// domain, reference lines, and the tooltip all come from the metric's view
// descriptor + unit — there is no per-metric chart component. Sustained-throttling
// (429) windows are shaded when the series carries them (RU / requests providers).

const EMPTY_POINTS: MetricPoint[] = [];

const SERIES_COLOR = 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))';
const INDEX_COLOR = 'var(--vscode-charts-orange, var(--vscode-textLink-foreground))';
const THROTTLE_COLOR = tokens.colorStatusDangerForeground1;
const GRID_COLOR = tokens.colorNeutralStroke2;
const AXIS_COLOR = tokens.colorNeutralForeground2;
const REFERENCE_COLOR = tokens.colorNeutralForeground2;

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
        color: tokens.colorNeutralForeground2,
        textAlign: 'center',
    },
    explanation: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        minWidth: 0,
        maxWidth: '640px',
        overflowWrap: 'anywhere',
        '& > p': {
            margin: 0,
        },
    },
    tooltip: {
        ...typographyStyles.body1,
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        boxShadow: tokens.shadow8,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
    },
    throttleNote: {
        color: tokens.colorStatusDangerForeground1,
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
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
    const themedTooltipClassName = useThemedTooltipClassName();
    if (!active || !payload || payload.length === 0) {
        return null;
    }
    const point = payload[0].payload;
    return (
        <div className={mergeClasses(styles.tooltip, themedTooltipClassName)}>
            <Text weight="semibold">{formatTimestamp(point.timestamp)}</Text>
            {point.storage ? (
                <>
                    <Text>{storageDescription(point.storage)}</Text>
                    {summarizeStorage(point.storage).status === 'partial' && <Text>{l10n.t('Partial data')}</Text>}
                </>
            ) : (
                <Text>{`${descriptor.seriesLabel}: ${formatMetricValue(descriptor.unit, point.value)}`}</Text>
            )}
            {point.throttled && (
                <Text className={themedTooltipClassName ? undefined : styles.throttleNote}>
                    {l10n.t('Sustained throttling (429s) in this window')}
                </Text>
            )}
        </div>
    );
};

export const MetricChart = ({
    descriptor,
    series,
    applicability = series?.applicability,
    loading,
    timeRange,
}: {
    descriptor: MetricViewDescriptor;
    series?: MetricSeriesResult;
    applicability?: MetricApplicability;
    loading: boolean;
    timeRange: TimeRange;
}) => {
    const styles = useStyles();

    const points = series?.points ?? EMPTY_POINTS;
    const storage = series?.storage;
    const chartPoints = useMemo(
        () =>
            points.map((point) => ({
                ...point,
                dataBytes: point.storage?.data.status === 'available' ? point.storage.data.bytes : undefined,
                indexBytes: point.storage?.index.status === 'available' ? point.storage.index.bytes : undefined,
            })),
        [points],
    );
    const bands = useMemo(() => throttlingBands(series?.points ?? EMPTY_POINTS), [series?.points]);
    // Thin labels, not chart data; keep both ends of the time window available to the axis.
    const timeTicks = useMemo(
        () =>
            points.filter((_, index) => index % 5 === 0 || index === points.length - 1).map((point) => point.timestamp),
        [points],
    );

    const yDomain = useMemo<[number, number | 'auto']>(() => {
        if (descriptor.yDomain === 'zeroTo100') {
            const peak = series?.peak ?? 0;
            return [0, Math.max(100, Math.ceil(peak / 10) * 10)];
        }
        return [0, 'auto'];
    }, [descriptor.yDomain, series?.peak]);

    if (applicability?.status === 'notApplicable') {
        return (
            <div className={styles.emptyState}>
                <div className={styles.explanation}>
                    <Text as="p" block weight="semibold">
                        {l10n.t('Not applicable')}
                    </Text>
                    <Text as="p" block>
                        {metricInapplicabilityExplanation(applicability.reason)}
                    </Text>
                </div>
            </div>
        );
    }

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
                {storage ? (
                    <output className={styles.explanation}>
                        <Text>{l10n.t('Storage unavailable')}</Text>
                        <Text>{storageDescription(storage)}</Text>
                    </output>
                ) : series?.reason === 'error' ? (
                    <output>
                        <Text>{l10n.t('Unable to load metric data. Use Refresh to try again.')}</Text>
                    </output>
                ) : (
                    <EmptyState reason={series?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />
                )}
            </div>
        );
    }

    return (
        <figure
            style={{ margin: 0 }}
            aria-label={storage ? descriptor.label : undefined}
            aria-description={
                storage
                    ? `${storageDescription(storage)} ${l10n.t(
                          'Data uses a solid line; indexes use a dashed line. Missing observations appear as gaps.',
                      )}`
                    : undefined
            }
        >
            {!storage && (
                <figcaption className={styles.srOnly}>
                    {l10n.t(
                        '{0} over the selected window, peak {1}.',
                        descriptor.label,
                        formatMetricValue(descriptor.unit, series.peak),
                    )}
                </figcaption>
            )}
            <div className={styles.chartArea}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart accessibilityLayer data={chartPoints} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                        <XAxis
                            dataKey="timestamp"
                            type="number"
                            scale="time"
                            domain={['dataMin', 'dataMax']}
                            ticks={timeTicks}
                            interval="preserveStartEnd"
                            minTickGap={24}
                            tickMargin={8}
                            tickFormatter={(ts: number) => formatTick(ts, timeRange)}
                            stroke={AXIS_COLOR}
                            tick={{
                                fill: AXIS_COLOR,
                                fontSize: tokens.fontSizeBase200,
                                fontFamily: tokens.fontFamilyBase,
                            }}
                        />
                        <YAxis
                            domain={yDomain}
                            tickFormatter={(v: number) => formatAxisTick(descriptor.unit, v)}
                            stroke={AXIS_COLOR}
                            tick={{
                                fill: AXIS_COLOR,
                                fontSize: tokens.fontSizeBase200,
                                fontFamily: tokens.fontFamilyBase,
                            }}
                            width={52}
                        />
                        <Tooltip filterNull={!storage} content={<ChartTooltip descriptor={descriptor} />} />
                        {storage && <Legend />}
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
                                    fontSize: tokens.fontSizeBase200,
                                    fontFamily: tokens.fontFamilyBase,
                                }}
                            />
                        ))}
                        {storage ? (
                            <>
                                <Line
                                    name={
                                        points.some((point) => point.storage?.data.status === 'available')
                                            ? l10n.t('Data')
                                            : `${l10n.t('Data')} — ${storageObservationLabel(storage.data)}`
                                    }
                                    type="linear"
                                    dataKey="dataBytes"
                                    stroke={SERIES_COLOR}
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    isAnimationActive={false}
                                    connectNulls={false}
                                />
                                <Line
                                    name={
                                        points.some((point) => point.storage?.index.status === 'available')
                                            ? l10n.t('Indexes')
                                            : `${l10n.t('Indexes')} — ${storageObservationLabel(storage.index)}`
                                    }
                                    type="linear"
                                    dataKey="indexBytes"
                                    stroke={INDEX_COLOR}
                                    strokeDasharray="6 4"
                                    strokeWidth={2}
                                    dot={{ r: 2 }}
                                    isAnimationActive={false}
                                    connectNulls={false}
                                />
                            </>
                        ) : (
                            <Line
                                type="monotone"
                                dataKey="value"
                                stroke={SERIES_COLOR}
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                                connectNulls
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </figure>
    );
};
