/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from '@fluentui/react-components';
import { MetricGrid } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { useRef, useState } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import {
    groupOverviewHealthFindings,
    type OverviewFinding,
    overviewCategoryState,
} from '../AccountOverviewV2/overviewFindingsModel';
import { summarizeMetric } from '../AccountOverviewV2/overviewMetricsModel';
import { summarizeThroughput, THROTTLING_GUIDE_PERCENT } from '../AccountOverviewV2/overviewThroughputModel';
import { type OverviewAnalyticsState } from '../AccountOverviewV2/useOverviewAnalytics';
import { DashboardFrame, useDashboardScope } from './DashboardFrame';
import { formatDelta, formatPercent, formatRu, peakTone, scopeLabel, seriesValues, type Tone } from './dashboardModel';
import { AlertWindowPicker, CoverageNotice, FindingList, PartitionsPanel, TopConsumersPanel } from './DashboardPanels';
import { CountBadge, DashboardMetric, TileValue } from './DashboardParts';
import { InventoryPanel } from './InventoryPanel';

type TriageTab = 'health' | 'recommendations' | 'consumers' | 'partitions';

/** Finding rules whose evidence lives in the partition view. */
const PARTITION_RULES = new Set(['HotPartitionRisk', 'StorageSkewRisk', 'StorageGrowthRisk']);

export function inspectAction(
    finding: OverviewFinding,
    inspectPartitions: (databaseId: string, containerId: string) => void,
    showConsumers: () => void,
): { label: string; run: () => void } | undefined {
    const [databaseId, containerId] = finding.scope.split('/');
    if (finding.rule && PARTITION_RULES.has(finding.rule) && databaseId && containerId) {
        return { label: l10n.t('Inspect partitions'), run: () => inspectPartitions(databaseId, containerId) };
    }
    if (finding.rule === 'SustainedThrottlingInRegion' || finding.rule === 'SharedThroughputStarvation') {
        return { label: l10n.t('Show top consumers'), run: showConsumers };
    }
    return undefined;
}

/**
 * Option 2, "Triage". The preview layout's problem-first reading order (health findings, throughput health, top
 * consumers, then recommendations) re-set in the DocumentDB grammar: throughput health becomes the metric cards,
 * findings and consumers become tabs led by the health tab, and the inventory closes the page sorted by pressure.
 */
export function TriageVariant({
    overview,
    analytics,
}: {
    overview: AccountOverviewState;
    analytics: OverviewAnalyticsState;
}) {
    const [tab, setTab] = useState<TriageTab>('health');
    const tabsRef = useRef<HTMLElement>(null);
    const { currentDatabase, setCurrentDatabase } = useDashboardScope(overview);
    const scope = scopeLabel(overview);

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
    const availability = summarizeMetric('serviceAvailability', overview.trends.serviceAvailability, context);

    const health = overviewCategoryState(overview, 'findings');
    const recommendations = overviewCategoryState(overview, 'recommendations');
    const grouped = groupOverviewHealthFindings(health.findings);
    const worst = grouped.some((finding) => finding.priority === 0) ? 'danger' : 'warning';

    const focusTabs = () => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const inspectPartitions = (databaseId: string, containerId: string) => {
        overview.handleSelectPartitionContainer({ databaseId, containerId });
        setTab('partitions');
        focusTabs();
    };
    const showConsumers = () => {
        setTab('consumers');
        focusTabs();
    };

    const pending = (state: string) => (state === 'loading' ? undefined : null);
    const measured = (state: string) => state === 'ready' || state === 'partial';
    const throttleTone: Tone | undefined =
        throughput.throttling.value === undefined
            ? undefined
            : throughput.throttling.value >= THROTTLING_GUIDE_PERCENT
              ? 'danger'
              : throughput.throttling.value >= 1
                ? 'warning'
                : 'success';

    return (
        <DashboardFrame overview={overview}>
            <div className="statusStrip">
                <MetricGrid className="metricsRow">
                    <DashboardMetric
                        label={l10n.t('Normalized RU')}
                        description={`${scope}. ${throughput.peak.detail}`}
                        value={
                            measured(throughput.peak.state) ? (
                                <TileValue
                                    primary={formatPercent(throughput.normalized.value)}
                                    secondary={l10n.t('peak {value}', { value: formatPercent(throughput.peak.value) })}
                                    tone={peakTone(throughput.peak.value)}
                                    spark={seriesValues(overview.trends.normalizedRu)}
                                    sparkTone={peakTone(throughput.peak.value)}
                                />
                            ) : (
                                pending(throughput.peak.state)
                            )
                        }
                    />
                    <DashboardMetric
                        label={l10n.t('Throttled requests (429)')}
                        description={`${scope}. ${throughput.throttling.detail} ${l10n.t(
                            'Investigate sustained rates above {guide}%.',
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
                            ) : (
                                pending(throughput.throttling.state)
                            )
                        }
                    />
                    <DashboardMetric
                        label={l10n.t('Consumed RU/s (peak)')}
                        description={`${scope}. ${throughput.consumed.detail}`}
                        value={
                            measured(throughput.consumed.state) ? (
                                <TileValue
                                    primary={formatRu(throughput.consumed.value)}
                                    secondary={
                                        overview.summary?.isServerless
                                            ? l10n.t('serverless')
                                            : throughput.autoscale.value !== undefined
                                              ? l10n.t('of {ru} max', { ru: formatRu(throughput.autoscale.value) })
                                              : throughput.provisioned.value !== undefined
                                                ? l10n.t('of {ru}', { ru: formatRu(throughput.provisioned.value) })
                                                : undefined
                                    }
                                />
                            ) : (
                                pending(throughput.consumed.state)
                            )
                        }
                    />
                    <DashboardMetric
                        label={l10n.t('Availability')}
                        description={l10n.t(
                            'Account-wide, latest reported hourly average; not an SLA figure. Region configuration is shown in the header.',
                        )}
                        value={
                            measured(availability.state) ? (
                                <TileValue
                                    primary={formatPercent(availability.value, 3)}
                                    secondary={
                                        overview.summary
                                            ? l10n.t('{count} regions', {
                                                  count: new Set([
                                                      ...overview.summary.writeRegions,
                                                      ...overview.summary.readRegions,
                                                  ]).size,
                                              })
                                            : undefined
                                    }
                                    tone={
                                        availability.value !== undefined && availability.value < 99.99
                                            ? 'warning'
                                            : 'success'
                                    }
                                />
                            ) : (
                                pending(availability.state)
                            )
                        }
                    />
                </MetricGrid>
            </div>

            <section className="investigationArea" aria-label={l10n.t('Investigation')} ref={tabsRef}>
                <TabList
                    className="investigationTabs"
                    selectedValue={tab}
                    onTabSelect={(_, data) => setTab(data.value as TriageTab)}
                >
                    <Tab value="health">
                        {l10n.t('Health')}
                        <CountBadge count={grouped.length} tone={worst} />
                    </Tab>
                    <Tab value="recommendations">
                        {l10n.t('Recommendations')}
                        <CountBadge count={recommendations.findings.length} />
                    </Tab>
                    <Tab value="consumers">{l10n.t('Top consumers')}</Tab>
                    <Tab value="partitions">{l10n.t('Partitions')}</Tab>
                </TabList>

                {tab === 'health' && (
                    <div className="tabPanel">
                        <div className="panelToolbar">
                            <span className="panelCaption">
                                {l10n.t('Alerts and derived checks, grouped by rule, worst first')}
                            </span>
                            <span className="panelToolbarEnd">
                                <AlertWindowPicker overview={overview} />
                            </span>
                        </div>
                        <FindingList
                            overview={overview}
                            findings={grouped}
                            loading={health.loading}
                            notice={<CoverageNotice overview={overview} />}
                            emptyTitle={l10n.t('No active health findings')}
                            emptyDescription={health.empty}
                            onInspect={(finding) => inspectAction(finding, inspectPartitions, showConsumers)}
                        />
                    </div>
                )}
                {tab === 'recommendations' && (
                    <div className="tabPanel">
                        <span className="panelCaption">
                            {l10n.t(
                                'Derived checks and Azure Advisor. Benefits are qualitative, not measured savings.',
                            )}
                        </span>
                        <FindingList
                            overview={overview}
                            findings={recommendations.findings}
                            loading={recommendations.loading}
                            emptyTitle={l10n.t('No recommendations')}
                            emptyDescription={recommendations.empty}
                        />
                    </div>
                )}
                {tab === 'consumers' && (
                    <TopConsumersPanel
                        overview={overview}
                        analytics={analytics}
                        onInspectPartitions={inspectPartitions}
                    />
                )}
                {tab === 'partitions' && <PartitionsPanel overview={overview} />}
            </section>

            <InventoryPanel
                overview={overview}
                currentDatabase={currentDatabase}
                onCurrentDatabaseChange={setCurrentDatabase}
                onInspectPartitions={inspectPartitions}
                defaultSort={{ column: 'peakRuPercent', direction: 'descending' }}
            />
        </DashboardFrame>
    );
}
