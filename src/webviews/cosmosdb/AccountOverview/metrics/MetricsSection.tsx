/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    makeStyles,
    Option,
    Text,
    tokens,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import { Database16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState } from 'react';
import { type MetricKey, type MetricSeriesResult, type TimeRange } from '../../../api/types';
import { DashboardCard, SectionHeader } from '../DashboardChrome';
import { type ContainerRef, METRIC_GROUPS, type MetricGroup, type MetricScope, METRIC_VIEWS } from './descriptors';
import { MetricChart } from './MetricChart';
import { MetricTile } from './MetricTile';

// ─── Metrics section ────────────────────────────────────────────────────────────
//
// The dashboard's headline metric surface: a global controls bar (time range +
// database scope) sits on top because it drives everything below, then a row of
// selectable scalar tiles (one per registered metric) grouped by emission family —
// `state` tiles first, then `activity` — and finally the selected metric's chart
// expanded inline. An accordion, never a drawer, so the alerts rail stays adjacent
// and the inventory table below stays anchored. The scope mirrors the portal:
// account-wide or a single database (collections are surfaced in the inventory
// table below, not this dropdown). A tile is selected on load so a chart is always visible.

const TIME_RANGES: TimeRange[] = ['1H', '24H', '7D'];
const ACCOUNT_OPTION = 'account';

/** Tile ordering by emission family: state gauges first, then activity flows. */
const GROUP_ORDER: MetricGroup[] = ['state', 'activity'];

const TIME_RANGE_ARIA: Record<TimeRange, string> = {
    '1H': l10n.t('Show the last hour'),
    '24H': l10n.t('Show the last 24 hours'),
    '7D': l10n.t('Show the last 7 days'),
};

const useStyles = makeStyles({
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: tokens.spacingHorizontalM,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
        marginBottom: tokens.spacingVerticalM,
    },
    optionRow: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    optionIcon: {
        flexShrink: 0,
        color: 'var(--vscode-descriptionForeground)',
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
    },
    legendSwatch: {
        width: '10px',
        height: '10px',
        borderRadius: tokens.borderRadiusSmall,
        flexShrink: 0,
    },
    legendText: {
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
    },
    visuallyHidden: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

export const MetricsSection = ({
    order,
    seriesByMetric,
    loading,
    timeRange,
    onTimeRangeChange,
    containers,
    selectedContainer,
    onSelectContainer,
}: {
    order: readonly MetricKey[];
    seriesByMetric: Partial<Record<MetricKey, MetricSeriesResult>>;
    loading: boolean;
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    containers: ContainerRef[];
    selectedContainer?: MetricScope;
    onSelectContainer: (scope?: MetricScope) => void;
}) => {
    const styles = useStyles();
    const [selectedMetric, setSelectedMetric] = useState<MetricKey>('normalizedRu');

    const activeDescriptor = METRIC_VIEWS[selectedMetric];
    const activeSeries = seriesByMetric[selectedMetric];

    // Group tiles by emission family (state first, then activity). Array.sort is stable, so the
    // caller's order is preserved within each family.
    const groupedOrder = useMemo(
        () =>
            [...order].sort(
                (a, b) => GROUP_ORDER.indexOf(METRIC_VIEWS[a].group) - GROUP_ORDER.indexOf(METRIC_VIEWS[b].group),
            ),
        [order],
    );

    // The scope dropdown mirrors the portal: account-wide or a whole database. Per-collection detail
    // lives in the inventory table below, so the dropdown stays small even with thousands of
    // collections. Derive the unique, sorted database list from the inventory containers.
    const databases = useMemo(() => [...new Set(containers.map((c) => c.databaseId))].sort(), [containers]);

    // The scope is account-wide or a whole database; the dropdown only emits those two today. A
    // container-scoped selection would show the container name here, but no container drill-in is
    // currently wired, so `selectedContainer` always carries just a databaseId.
    const selectedValue = selectedContainer ? selectedContainer.databaseId : ACCOUNT_OPTION;
    const selectedText = selectedContainer
        ? (selectedContainer.containerId ?? selectedContainer.databaseId)
        : l10n.t('Account');

    const handleContainerSelect = (_: unknown, data: OptionOnSelectData) => {
        const value = data.optionValue;
        if (!value || value === ACCOUNT_OPTION) {
            onSelectContainer(undefined);
            return;
        }
        onSelectContainer({ databaseId: value });
    };

    return (
        <>
            <div className={styles.toolbar}>
                <div className={styles.rangePills} role="toolbar" aria-label={l10n.t('Metric time range')}>
                    {TIME_RANGES.map((range) => (
                        <Button
                            key={range}
                            size="small"
                            appearance={range === timeRange ? 'primary' : 'subtle'}
                            aria-pressed={range === timeRange}
                            aria-label={`${TIME_RANGE_ARIA[range]} (${range})`}
                            onClick={() => onTimeRangeChange(range)}
                        >
                            {range}
                        </Button>
                    ))}
                </div>
                <Dropdown
                    className={styles.containerSelect}
                    aria-label={l10n.t('Database scope for metrics')}
                    value={selectedText}
                    selectedOptions={[selectedValue]}
                    onOptionSelect={handleContainerSelect}
                >
                    <Option value={ACCOUNT_OPTION} text={l10n.t('Account')}>
                        {l10n.t('Account')}
                    </Option>
                    {databases.map((databaseId) => (
                        <Option key={databaseId} value={databaseId} text={databaseId}>
                            <span className={styles.optionRow}>
                                <Database16Regular className={styles.optionIcon} aria-hidden="true" />
                                {databaseId}
                            </span>
                        </Option>
                    ))}
                </Dropdown>
            </div>

            <div className={styles.grid}>
                {groupedOrder.map((key) => (
                    <MetricTile
                        key={key}
                        descriptor={METRIC_VIEWS[key]}
                        series={seriesByMetric[key]}
                        loading={loading}
                        selected={key === selectedMetric}
                        onSelect={() => setSelectedMetric(key)}
                    />
                ))}
            </div>

            <div className={styles.legend}>
                {(Object.keys(METRIC_GROUPS) as MetricGroup[]).map((groupKey) => {
                    const meta = METRIC_GROUPS[groupKey];
                    return (
                        <span key={groupKey} className={styles.legendItem} title={meta.description}>
                            <span
                                className={styles.legendSwatch}
                                style={{ backgroundColor: meta.color }}
                                aria-hidden="true"
                            />
                            <Text className={styles.legendText}>{meta.label}</Text>
                            <Text className={styles.visuallyHidden}>{meta.description}</Text>
                        </span>
                    );
                })}
            </div>

            <DashboardCard>
                <SectionHeader
                    title={l10n.t('{0} trend', activeDescriptor.label)}
                    description={l10n.t('Select a tile above to chart a different metric over the chosen window.')}
                />
                <MetricChart
                    descriptor={activeDescriptor}
                    series={activeSeries}
                    loading={loading}
                    timeRange={timeRange}
                />
            </DashboardCard>
        </>
    );
};
