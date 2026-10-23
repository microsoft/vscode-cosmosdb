/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, tokens, typographyStyles } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type MetricApplicability, type MetricKey, type MetricSeriesResult, type TimeRange } from '../../../api/types';
import { ThemedTooltip } from '../../../common/ThemedTooltip';
import { DashboardCard, SectionHeader } from '../DashboardChrome';
import { METRIC_GROUPS, type MetricGroup, METRIC_VIEWS } from './descriptors';
import { MetricChart } from './MetricChart';
import { MetricTile } from './MetricTile';

// ─── Metrics section ────────────────────────────────────────────────────────────
//
// Selectable metric tiles are grouped by emission family, followed by the selected metric's chart.
// Time range and database scope are controlled by the account header.

/** Tile ordering by emission family: state gauges first, then activity flows. */
const GROUP_ORDER: MetricGroup[] = ['state', 'activity'];

const useStyles = makeStyles({
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: tokens.spacingHorizontalM,
    },
    legend: {
        display: 'flex',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalM,
        marginTop: tokens.spacingVerticalS,
        marginBottom: tokens.spacingVerticalM,
    },
    legendItem: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        cursor: 'default',
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThin,
        },
    },
    legendSwatch: {
        width: '10px',
        height: '10px',
        borderRadius: tokens.borderRadiusSmall,
        flexShrink: 0,
    },
    legendText: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    visuallyHidden: {
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
    chartRegion: {
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThick,
        },
    },
});

export const MetricsSection = ({
    order,
    seriesByMetric,
    applicabilityByMetric,
    loading,
    timeRange,
    chartAffordances = false,
    requestedMetric,
    navigationRevision = 0,
    active = true,
}: {
    order: readonly MetricKey[];
    seriesByMetric: Partial<Record<MetricKey, MetricSeriesResult>>;
    applicabilityByMetric?: Partial<Record<MetricKey, MetricApplicability>>;
    loading: boolean;
    timeRange: TimeRange;
    chartAffordances?: boolean;
    requestedMetric?: MetricKey;
    navigationRevision?: number;
    active?: boolean;
}) => {
    const styles = useStyles();
    const groupLabelId = useId();
    const [explicitMetric, setSelectedMetric] = useState<MetricKey | undefined>(requestedMetric);
    const normalizedRuApplicability = applicabilityByMetric?.normalizedRu ?? seriesByMetric.normalizedRu?.applicability;
    const candidateMetric =
        explicitMetric ??
        (normalizedRuApplicability?.status === 'notApplicable' ? 'totalRequestUnits' : 'normalizedRu');
    const selectedMetric =
        (applicabilityByMetric?.[candidateMetric] ?? seriesByMetric[candidateMetric]?.applicability)?.status ===
        'notApplicable'
            ? 'totalRequestUnits'
            : candidateMetric;
    const chartRef = useRef<HTMLElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const focusedTile = useRef<HTMLElement | null>(null);
    const handledNavigation = useRef<number | undefined>(undefined);

    useLayoutEffect(() => {
        const focused = focusedTile.current;
        if (focused && !focused.isConnected) {
            focusedTile.current = null;
            if (active && document.hasFocus() && document.activeElement === document.body) {
                gridRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
            }
        }
    });

    useEffect(() => {
        if (requestedMetric) {
            setSelectedMetric(requestedMetric);
        }
    }, [requestedMetric, navigationRevision]);

    useEffect(() => {
        if (active && requestedMetric && handledNavigation.current !== navigationRevision) {
            handledNavigation.current = navigationRevision;
            chartRef.current?.focus({ preventScroll: true });
            chartRef.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [active, requestedMetric, selectedMetric, navigationRevision]);

    const activeDescriptor = METRIC_VIEWS[selectedMetric];
    const activeSeries = seriesByMetric[selectedMetric];
    const activeApplicability = applicabilityByMetric?.[selectedMetric] ?? activeSeries?.applicability;

    const groupedOrder = useMemo(
        () =>
            order
                .filter(
                    (key) =>
                        (applicabilityByMetric?.[key] ?? seriesByMetric[key]?.applicability)?.status !==
                        'notApplicable',
                )
                .sort(
                    (a, b) => GROUP_ORDER.indexOf(METRIC_VIEWS[a].group) - GROUP_ORDER.indexOf(METRIC_VIEWS[b].group),
                ),
        [order, applicabilityByMetric, seriesByMetric],
    );

    return (
        <>
            <div
                className={styles.grid}
                ref={gridRef}
                onFocusCapture={(event) => {
                    focusedTile.current = event.target;
                }}
            >
                {groupedOrder.map((key) => (
                    <MetricTile
                        key={key}
                        descriptor={METRIC_VIEWS[key]}
                        series={seriesByMetric[key]}
                        applicability={applicabilityByMetric?.[key] ?? seriesByMetric[key]?.applicability}
                        loading={loading}
                        selected={key === selectedMetric}
                        onSelect={() => setSelectedMetric(key)}
                        chartAffordances={chartAffordances}
                        groupLabelId={`${groupLabelId}-${METRIC_VIEWS[key].group}`}
                    />
                ))}
            </div>

            <div className={styles.legend}>
                {(Object.keys(METRIC_GROUPS) as MetricGroup[]).map((groupKey) => {
                    const meta = METRIC_GROUPS[groupKey];
                    return (
                        <ThemedTooltip key={groupKey} content={meta.description} relationship="inaccessible">
                            <Text
                                className={styles.legendItem}
                                tabIndex={0}
                                aria-description={chartAffordances ? meta.description : undefined}
                            >
                                <span
                                    className={styles.legendSwatch}
                                    style={{ backgroundColor: meta.color }}
                                    aria-hidden="true"
                                />
                                <Text id={`${groupLabelId}-${groupKey}`} className={styles.legendText}>
                                    {meta.label}
                                </Text>
                                {!chartAffordances && <Text className={styles.visuallyHidden}>{meta.description}</Text>}
                            </Text>
                        </ThemedTooltip>
                    );
                })}
            </div>

            <section
                ref={chartRef}
                className={styles.chartRegion}
                aria-label={l10n.t('{0} trend', activeDescriptor.label)}
                tabIndex={-1}
            >
                <DashboardCard>
                    <SectionHeader
                        title={l10n.t('{0} trend', activeDescriptor.label)}
                        description={l10n.t('Select a tile above to chart a different metric over the chosen window.')}
                    />
                    <MetricChart
                        descriptor={activeDescriptor}
                        series={activeSeries}
                        applicability={activeApplicability}
                        loading={loading}
                        timeRange={timeRange}
                    />
                </DashboardCard>
            </section>
        </>
    );
};
