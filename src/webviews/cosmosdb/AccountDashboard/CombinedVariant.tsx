/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Tab, TabList, Text } from '@fluentui/react-components';
import { MetricGrid } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { useRef, useState } from 'react';
import { type TimeRange } from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { groupOverviewHealthFindings, overviewCategoryState } from '../AccountOverviewV2/overviewFindingsModel';
import { summarizeThroughput, THROTTLING_GUIDE_PERCENT } from '../AccountOverviewV2/overviewThroughputModel';
import { type OverviewAnalyticsState } from '../AccountOverviewV2/useOverviewAnalytics';
import { DashboardFrame, useDashboardScope } from './DashboardFrame';
import {
    formatBytes,
    formatCount,
    formatDelta,
    formatPercent,
    formatRu,
    latestValue,
    peakTone,
    scopeLabel,
    seriesValues,
    TIME_RANGE_LABELS,
    TIME_RANGES,
    tileState,
    type Tone,
} from './dashboardModel';
import {
    AlertWindowPicker,
    CoverageNotice,
    FindingList,
    MetricsExplorerPanel,
    PartitionsPanel,
    TopConsumersPanel,
} from './DashboardPanels';
import { CountBadge, ChoiceGroup, DashboardMetric, InlineSettingMenu, TileValue } from './DashboardParts';
import { InventoryPanel } from './InventoryPanel';
import { inspectAction } from './TriageVariant';

type CombinedTab = 'insights' | 'metrics' | 'throughput' | 'partitions';
type InsightFilter = 'all' | 'issues' | 'recommendations';

/** Database ids cannot contain '/', so this never collides with a real database. */
const ACCOUNT_SCOPE = '/';

/**
 * Option 3, "Combined". Keeps Option 1's live cards and metrics explorer and Option 2's problem-first findings and
 * capacity reading, and fixes what both left implicit: the page says which scope it is showing, the four cards pair
 * saturation with throttling, findings are one ranked list instead of one tab per data source, and the investigation
 * area opens on insights only when something needs attention.
 */
export function CombinedVariant({
    overview,
    analytics,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
}) {
    const health = overviewCategoryState(overview, 'findings');
    const recommendations = overviewCategoryState(overview, 'recommendations');
    const issues = groupOverviewHealthFindings(health.findings);
    const urgent = issues.some((finding) => finding.priority <= 1);

    const [tabChoice, setTab] = useState<CombinedTab>();
    const tab: CombinedTab = tabChoice ?? (urgent || health.loading ? 'insights' : 'metrics');
    const [filter, setFilter] = useState<InsightFilter>('all');
    const tabsRef = useRef<HTMLElement>(null);
    const { currentDatabase, setCurrentDatabase } = useDashboardScope(overview);
    const databaseIds = overview.inventory?.databases ?? [...new Set(overview.containers.map((c) => c.databaseId))];

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
    const measured = (state: string) => state === 'ready' || state === 'partial';
    const throttleTone: Tone | undefined =
        throughput.throttling.value === undefined
            ? undefined
            : throughput.throttling.value >= THROTTLING_GUIDE_PERCENT
              ? 'danger'
              : throughput.throttling.value >= 1
                ? 'warning'
                : 'success';

    const focusTabs = () => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const inspectPartitions = (databaseId: string, containerId: string) => {
        overview.handleSelectPartitionContainer({ databaseId, containerId });
        setTab('partitions');
        focusTabs();
    };
    const showThroughput = () => {
        setTab('throughput');
        focusTabs();
    };

    const insightFindings =
        filter === 'issues'
            ? issues
            : filter === 'recommendations'
              ? recommendations.findings
              : [...issues, ...recommendations.findings];
    const insightCount = issues.length + recommendations.findings.length;
    const scope = scopeLabel(overview);
    const windowLabel = TIME_RANGE_LABELS[overview.timeRange];

    return (
        <DashboardFrame overview={overview}>
            <div className="scopeLine">
                <span className="panelCaption">{l10n.t('Showing')}</span>
                <InlineSettingMenu
                    label={l10n.t('Scope of the metrics, insights and inventory below')}
                    value={currentDatabase ?? ACCOUNT_SCOPE}
                    options={[
                        [ACCOUNT_SCOPE, l10n.t('Whole account')],
                        ...databaseIds.map((id) => [id, l10n.t('Database {name}', { name: id })] as const),
                    ]}
                    onChange={(value) => setCurrentDatabase(value === ACCOUNT_SCOPE ? undefined : value)}
                />
                <span className="panelCaption" aria-hidden="true">
                    ·
                </span>
                <InlineSettingMenu<TimeRange>
                    label={l10n.t('Time window for metrics, peaks and throttling')}
                    value={overview.timeRange}
                    options={TIME_RANGES.map((range) => [range, TIME_RANGE_LABELS[range]] as const)}
                    onChange={overview.setTimeRange}
                />
            </div>

            <div className="statusStrip">
                <MetricGrid className="metricsRow">
                    <DashboardMetric
                        label={l10n.t('Normalized RU')}
                        description={`${scope}. ${throughput.peak.detail}`}
                        value={tileState(overview, 'normalizedRu', (series) => (
                            <TileValue
                                primary={formatPercent(latestValue(series))}
                                secondary={l10n.t('peak {value}', { value: formatPercent(series.peak) })}
                                tone={peakTone(series.peak)}
                                spark={seriesValues(series)}
                                sparkTone={peakTone(series.peak)}
                            />
                        ))}
                    />
                    <DashboardMetric
                        label={l10n.t('Throttled (429)')}
                        description={`${scope}. ${throughput.throttling.detail} ${l10n.t(
                            'Read together with normalized RU: 100% peaks are harmless while this stays low. Investigate sustained rates above {guide}%.',
                            { guide: THROTTLING_GUIDE_PERCENT },
                        )}`}
                        value={
                            measured(throughput.throttling.state) ? (
                                <TileValue
                                    primary={formatPercent(throughput.throttling.value, 2)}
                                    secondary={
                                        throughput.delta === undefined
                                            ? undefined
                                            : l10n.t('{delta} vs previous', { delta: formatDelta(throughput.delta) })
                                    }
                                    tone={
                                        throughput.delta !== undefined && throughput.delta > 0 ? 'danger' : throttleTone
                                    }
                                />
                            ) : throughput.throttling.state === 'loading' ? undefined : null
                        }
                    />
                    <DashboardMetric
                        label={l10n.t('Server latency')}
                        description={l10n.t('{scope}. Peak interval-average server-side latency; not P99.', { scope })}
                        value={tileState(overview, 'serverLatency', (series) => (
                            <TileValue
                                primary={l10n.t('{ms} ms', { ms: Math.round(series.peak ?? 0) })}
                                secondary={l10n.t('peak')}
                                spark={seriesValues(series)}
                            />
                        ))}
                    />
                    <DashboardMetric
                        label={l10n.t('Data + index')}
                        description={l10n.t(
                            '{scope}. Latest reported data and index storage, with the document count.',
                            {
                                scope,
                            },
                        )}
                        value={tileState(overview, 'dataIndexUsage', (series) => (
                            <TileValue
                                primary={formatBytes(latestValue(series))}
                                secondary={l10n.t('{count} docs', {
                                    count: formatCount(latestValue(overview.trends.documentCount)),
                                })}
                                spark={seriesValues(series)}
                            />
                        ))}
                    />
                </MetricGrid>
            </div>

            <section className="investigationArea" aria-label={l10n.t('Investigation')} ref={tabsRef}>
                <TabList
                    className="investigationTabs"
                    selectedValue={tab}
                    onTabSelect={(_, data) => setTab(data.value as CombinedTab)}
                >
                    <Tab value="insights">
                        {l10n.t('Insights')}
                        <CountBadge count={insightCount} tone={urgent ? 'warning' : 'informative'} />
                    </Tab>
                    <Tab value="metrics">{l10n.t('Metrics')}</Tab>
                    <Tab value="throughput">{l10n.t('Throughput')}</Tab>
                    <Tab value="partitions">{l10n.t('Partitions')}</Tab>
                </TabList>

                {tab === 'insights' && (
                    <div className="tabPanel">
                        <div className="panelToolbar">
                            <ChoiceGroup<InsightFilter>
                                label={l10n.t('Show')}
                                value={filter}
                                options={[
                                    ['all', `${l10n.t('All')} (${insightCount})`],
                                    ['issues', `${l10n.t('Issues')} (${issues.length})`],
                                    [
                                        'recommendations',
                                        `${l10n.t('Recommendations')} (${recommendations.findings.length})`,
                                    ],
                                ]}
                                onChange={setFilter}
                            />
                            <span className="panelToolbarEnd">
                                <span className="panelCaption">{l10n.t('Alerts from the last:')}</span>
                                <AlertWindowPicker overview={overview} />
                            </span>
                        </div>
                        <FindingList
                            overview={overview}
                            findings={insightFindings}
                            loading={health.loading || recommendations.loading}
                            notice={<CoverageNotice overview={overview} />}
                            emptyTitle={
                                filter === 'recommendations'
                                    ? l10n.t('No recommendations')
                                    : l10n.t('Nothing needs attention')
                            }
                            emptyDescription={filter === 'recommendations' ? recommendations.empty : health.empty}
                            onInspect={(finding) => inspectAction(finding, inspectPartitions, showThroughput)}
                        />
                    </div>
                )}
                {tab === 'metrics' && <MetricsExplorerPanel overview={overview} />}
                {tab === 'throughput' && (
                    <div className="tabPanel">
                        <Card>
                            <div className="chartHeader">
                                <Text weight="semibold" size={400}>
                                    {l10n.t('Capacity')}
                                </Text>
                                <span className="panelCaption">
                                    {scope} · {windowLabel}
                                </span>
                            </div>
                            <div className="summaryGridWide">
                                <DashboardMetric
                                    appearance="subtle"
                                    size="small"
                                    label={l10n.t('Consumed RU/s (peak)')}
                                    description={throughput.consumed.detail}
                                    value={
                                        measured(throughput.consumed.state) ? formatRu(throughput.consumed.value) : null
                                    }
                                />
                                <DashboardMetric
                                    appearance="subtle"
                                    size="small"
                                    label={l10n.t('Provisioned')}
                                    description={throughput.provisioned.detail}
                                    value={
                                        measured(throughput.provisioned.state)
                                            ? formatRu(throughput.provisioned.value)
                                            : null
                                    }
                                />
                                <DashboardMetric
                                    appearance="subtle"
                                    size="small"
                                    label={l10n.t('Autoscale maximum')}
                                    description={throughput.autoscale.detail}
                                    value={
                                        measured(throughput.autoscale.state)
                                            ? formatRu(throughput.autoscale.value)
                                            : null
                                    }
                                />
                                <DashboardMetric
                                    appearance="subtle"
                                    size="small"
                                    label={l10n.t('Throttled requests')}
                                    description={throughput.throttling.detail}
                                    value={
                                        analytics.data?.throttling.available
                                            ? l10n.t('{throttled} of {total}', {
                                                  throttled: formatCount(analytics.data.throttling.throttledRequests),
                                                  total: formatCount(analytics.data.throttling.totalRequests),
                                              })
                                            : analytics.loading
                                              ? undefined
                                              : null
                                    }
                                />
                            </div>
                        </Card>
                        <TopConsumersPanel
                            overview={overview}
                            analytics={analytics}
                            onInspectPartitions={inspectPartitions}
                        />
                    </div>
                )}
                {tab === 'partitions' && <PartitionsPanel overview={overview} />}
            </section>

            <InventoryPanel
                overview={overview}
                currentDatabase={currentDatabase}
                onCurrentDatabaseChange={setCurrentDatabase}
                onInspectPartitions={inspectPartitions}
            />
        </DashboardFrame>
    );
}
