/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    makeStyles,
    Option,
    Spinner,
    Text,
    tokens,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useMemo, useState } from 'react';
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
import { type RuTrendPoint, type RuTrendsResult, type TimeRange } from '../../api/types';
import { EmptyState } from './DashboardChrome';

const TIME_RANGES: TimeRange[] = ['1H', '24H', '7D'];
const ACCOUNT_OPTION = 'account';
const EMPTY_POINTS: RuTrendPoint[] = [];

const TIME_RANGE_ARIA: Record<TimeRange, string> = {
    '1H': l10n.t('Show the last hour'),
    '24H': l10n.t('Show the last 24 hours'),
    '7D': l10n.t('Show the last 7 days'),
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    rangePills: {
        display: 'flex',
        gap: tokens.spacingHorizontalXS,
    },
    containerSelect: {
        minWidth: '200px',
    },
    legend: {
        display: 'flex',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
    },
    legendItem: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'var(--vscode-foreground)',
        fontSize: tokens.fontSizeBase200,
    },
    legendItemMuted: {
        opacity: 0.45,
    },
    swatch: {
        width: '12px',
        height: '12px',
        borderRadius: '2px',
        display: 'inline-block',
    },
    chartArea: {
        position: 'relative',
        width: '100%',
        height: '280px',
    },
    overlay: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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

const RU_COLOR = 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))';
const THROTTLE_COLOR = 'var(--vscode-errorForeground)';
const GRID_COLOR = 'var(--vscode-panel-border)';
const AXIS_COLOR = 'var(--vscode-descriptionForeground)';
const REFERENCE_COLOR = 'var(--vscode-charts-foreground, var(--vscode-descriptionForeground))';

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
function throttlingBands(points: RuTrendPoint[]): { x1: number; x2: number }[] {
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

export type ContainerRef = { databaseId: string; containerId: string };

interface ChartTooltipProps {
    active?: boolean;
    payload?: { payload: RuTrendPoint }[];
}

const ChartTooltip = ({ active, payload }: ChartTooltipProps) => {
    const styles = useStyles();
    if (!active || !payload || payload.length === 0) {
        return null;
    }
    const point = payload[0].payload;
    return (
        <div className={styles.tooltip}>
            <Text weight="semibold">{formatTimestamp(point.timestamp)}</Text>
            <Text>
                {l10n.t('Normalized RU: {value}%', {
                    value: point.ruPercent === undefined ? '—' : Math.round(point.ruPercent),
                })}
            </Text>
            {point.throttled && (
                <Text className={styles.throttleNote}>{l10n.t('Sustained throttling (429s) in this window')}</Text>
            )}
        </div>
    );
};

export const RuTrendsChart = ({
    trends,
    loading,
    timeRange,
    onTimeRangeChange,
    containers,
    selected,
    onSelectContainer,
}: {
    trends?: RuTrendsResult;
    loading: boolean;
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    containers: ContainerRef[];
    selected?: ContainerRef;
    onSelectContainer: (container?: ContainerRef) => void;
}) => {
    const styles = useStyles();
    const [ruHidden, setRuHidden] = useState(false);
    const [throttleHidden, setThrottleHidden] = useState(false);

    const points = trends?.points ?? EMPTY_POINTS;
    const bands = useMemo(() => throttlingBands(trends?.points ?? EMPTY_POINTS), [trends?.points]);

    const yMax = useMemo(() => {
        const peak = trends?.peakPercent ?? 0;
        return Math.max(100, Math.ceil(peak / 10) * 10);
    }, [trends?.peakPercent]);

    const selectedValue = selected ? `${selected.databaseId}/${selected.containerId}` : ACCOUNT_OPTION;
    const selectedText = selected ? selected.containerId : l10n.t('Account');

    const handleSelect = (_: unknown, data: OptionOnSelectData) => {
        const value = data.optionValue;
        if (!value || value === ACCOUNT_OPTION) {
            onSelectContainer(undefined);
            return;
        }
        const match = containers.find((c) => `${c.databaseId}/${c.containerId}` === value);
        onSelectContainer(match);
    };

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <div className={styles.rangePills}>
                    {TIME_RANGES.map((range) => (
                        <Button
                            key={range}
                            size="small"
                            appearance={range === timeRange ? 'primary' : 'subtle'}
                            aria-pressed={range === timeRange}
                            aria-label={TIME_RANGE_ARIA[range]}
                            onClick={() => onTimeRangeChange(range)}
                        >
                            {range}
                        </Button>
                    ))}
                </div>
                <Dropdown
                    className={styles.containerSelect}
                    aria-label={l10n.t('Container for trends')}
                    value={selectedText}
                    selectedOptions={[selectedValue]}
                    onOptionSelect={handleSelect}
                >
                    <Option value={ACCOUNT_OPTION}>{l10n.t('Account')}</Option>
                    {containers.map((c) => (
                        <Option key={`${c.databaseId}/${c.containerId}`} value={`${c.databaseId}/${c.containerId}`}>
                            {c.containerId}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            <div className={styles.legend}>
                <button
                    type="button"
                    className={ruHidden ? `${styles.legendItem} ${styles.legendItemMuted}` : styles.legendItem}
                    aria-pressed={!ruHidden}
                    onClick={() => setRuHidden((v) => !v)}
                >
                    <span className={styles.swatch} style={{ backgroundColor: RU_COLOR }} />
                    {l10n.t('Normalized RU %')}
                </button>
                <button
                    type="button"
                    className={throttleHidden ? `${styles.legendItem} ${styles.legendItemMuted}` : styles.legendItem}
                    aria-pressed={!throttleHidden}
                    onClick={() => setThrottleHidden((v) => !v)}
                >
                    <span className={styles.swatch} style={{ backgroundColor: THROTTLE_COLOR, opacity: 0.4 }} />
                    {l10n.t('Throttling window')}
                </button>
            </div>

            {loading && points.length === 0 ? (
                <div className={styles.emptyState}>
                    <Spinner size="small" label={l10n.t('Loading trends…')} />
                </div>
            ) : !trends?.available || points.length === 0 ? (
                <div className={styles.emptyState}>
                    <EmptyState reason={trends?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />
                </div>
            ) : (
                <figure
                    className={styles.chartArea}
                    style={{ margin: 0 }}
                    aria-label={l10n.t('Normalized RU consumption over time')}
                >
                    <figcaption className={styles.srOnly}>
                        {l10n.t(
                            'Peak {0} percent of provisioned throughput over the selected window, with {1} throttled intervals.',
                            Math.round(trends?.peakPercent ?? 0),
                            points.filter((p) => p.throttled).length,
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
                                domain={[0, yMax]}
                                tickFormatter={(v: number) => `${v}%`}
                                stroke={AXIS_COLOR}
                                tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                                width={44}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            {!throttleHidden &&
                                bands.map((band) => (
                                    <ReferenceArea
                                        key={`${band.x1}-${band.x2}`}
                                        x1={band.x1}
                                        x2={band.x2}
                                        fill={THROTTLE_COLOR}
                                        fillOpacity={0.15}
                                        ifOverflow="extendDomain"
                                    />
                                ))}
                            <ReferenceLine
                                y={trends.provisionedPercent}
                                stroke={REFERENCE_COLOR}
                                strokeDasharray="6 4"
                                label={{
                                    value: l10n.t('Provisioned (100%)'),
                                    position: 'insideTopRight',
                                    fill: AXIS_COLOR,
                                    fontSize: 11,
                                }}
                            />
                            {!ruHidden && (
                                <Line
                                    type="monotone"
                                    dataKey="ruPercent"
                                    stroke={RU_COLOR}
                                    strokeWidth={2}
                                    dot={false}
                                    isAnimationActive={false}
                                    connectNulls
                                />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                </figure>
            )}
        </div>
    );
};
