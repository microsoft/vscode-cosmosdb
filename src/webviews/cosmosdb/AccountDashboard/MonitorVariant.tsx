/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from '@fluentui/react-components';
import { MetricGrid } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { useRef, useState } from 'react';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { collectOverviewFindings } from '../AccountOverviewV2/overviewFindingsModel';
import { DashboardFrame, useDashboardScope } from './DashboardFrame';
import {
    formatBytes,
    formatCount,
    formatPercent,
    latestValue,
    peakTone,
    scopeLabel,
    seriesValues,
    sumValues,
    tileState,
} from './dashboardModel';
import {
    AlertWindowPicker,
    CoverageNotice,
    FindingList,
    MetricsExplorerPanel,
    PartitionsPanel,
} from './DashboardPanels';
import { CountBadge, DashboardMetric, TileValue } from './DashboardParts';
import { InventoryPanel } from './InventoryPanel';

type MonitorTab = 'metrics' | 'partitions' | 'alerts' | 'recommendations' | 'advisories';

/**
 * Option 1, "Monitor". The original layout's content (metric tiles and chart, partition health, and a rail of alerts,
 * Advisor recommendations and derived advisories) re-set in the DocumentDB grammar: the rail becomes counted tabs in
 * the investigation area, the nine tiles become four headline cards plus a metrics explorer tab.
 */
export function MonitorVariant({ overview }: { overview: AccountOverviewState }) {
    const [tab, setTab] = useState<MonitorTab>('metrics');
    const tabsRef = useRef<HTMLDivElement>(null);
    const { currentDatabase, setCurrentDatabase } = useDashboardScope(overview);

    const findings = collectOverviewFindings(overview);
    const alerts = findings.filter((finding) => finding.source === 'alert');
    const advisor = findings.filter((finding) => finding.source === 'advisor');
    const derived = findings.filter((finding) => finding.source === 'derived');
    const worstAlert = alerts.some((alert) => alert.priority === 0) ? 'danger' : 'warning';

    const inspectPartitions = (databaseId: string, containerId: string) => {
        overview.handleSelectPartitionContainer({ databaseId, containerId });
        setTab('partitions');
        tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const ru = overview.trends.normalizedRu;
    const scope = scopeLabel(overview);

    return (
        <DashboardFrame overview={overview}>
            <div className="statusStrip">
                <MetricGrid className="metricsRow">
                    <DashboardMetric
                        label={l10n.t('Normalized RU')}
                        description={l10n.t(
                            '{scope}. Latest reported normalized RU consumption, with the window peak. 100% means a partition used all of its provisioned throughput in an interval.',
                            { scope },
                        )}
                        value={tileState(overview, 'normalizedRu', (series) => (
                            <TileValue
                                primary={formatPercent(latestValue(series))}
                                secondary={l10n.t('peak {value}', { value: formatPercent(series.peak) })}
                                tone={peakTone(series.peak)}
                                spark={seriesValues(ru)}
                                sparkTone={peakTone(series.peak)}
                            />
                        ))}
                    />
                    <DashboardMetric
                        label={l10n.t('Requests')}
                        description={l10n.t('{scope}. Requests served in the selected window.', { scope })}
                        value={tileState(overview, 'totalRequests', (series) => (
                            <TileValue
                                primary={formatCount(sumValues(series))}
                                secondary={l10n.t('{ru} RU', {
                                    ru: formatCount(sumValues(overview.trends.totalRequestUnits)),
                                })}
                                spark={seriesValues(series)}
                            />
                        ))}
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
                    onTabSelect={(_, data) => setTab(data.value as MonitorTab)}
                >
                    <Tab value="metrics">{l10n.t('Metrics')}</Tab>
                    <Tab value="partitions">{l10n.t('Partitions')}</Tab>
                    <Tab value="alerts">
                        {l10n.t('Alerts')}
                        <CountBadge count={alerts.length} tone={worstAlert} />
                    </Tab>
                    <Tab value="recommendations">
                        {l10n.t('Advisor')}
                        <CountBadge count={advisor.length} />
                    </Tab>
                    <Tab value="advisories">
                        {l10n.t('Derived advisories')}
                        <CountBadge count={derived.length} tone="warning" />
                    </Tab>
                </TabList>

                {tab === 'metrics' && <MetricsExplorerPanel overview={overview} />}
                {tab === 'partitions' && <PartitionsPanel overview={overview} />}
                {tab === 'alerts' && (
                    <div className="tabPanel">
                        <div className="panelToolbar">
                            <AlertWindowPicker overview={overview} />
                            <span className="panelToolbarEnd panelCaption">
                                {l10n.t('Fired Azure Monitor alerts targeting this account')}
                            </span>
                        </div>
                        <FindingList
                            overview={overview}
                            findings={alerts}
                            loading={overview.alertsLoading}
                            emptyTitle={l10n.t('No fired alerts')}
                            emptyDescription={l10n.t(
                                'Azure Monitor reports no fired alerts for this account in the selected window.',
                            )}
                        />
                    </div>
                )}
                {tab === 'recommendations' && (
                    <div className="tabPanel">
                        <span className="panelCaption">{l10n.t('Azure Advisor guidance for this account')}</span>
                        <FindingList
                            overview={overview}
                            findings={advisor}
                            loading={overview.recommendationsLoading}
                            emptyTitle={l10n.t('No Advisor recommendations')}
                            emptyDescription={l10n.t('Azure Advisor has no open recommendations for this account.')}
                        />
                    </div>
                )}
                {tab === 'advisories' && (
                    <div className="tabPanel">
                        <span className="panelCaption">
                            {l10n.t("Computed in VS Code from this account's telemetry, not from the Azure portal")}
                        </span>
                        <FindingList
                            overview={overview}
                            findings={derived}
                            loading={overview.derivedLoading}
                            notice={<CoverageNotice overview={overview} />}
                            emptyTitle={l10n.t('No derived advisories')}
                            emptyDescription={l10n.t('No derived check fired. Dismissed advisories are not shown.')}
                            onInspect={(finding) =>
                                finding.rule === 'HotPartitionRisk' || finding.rule === 'StorageSkewRisk'
                                    ? {
                                          label: l10n.t('Inspect partitions'),
                                          run: () => {
                                              const [databaseId, containerId] = finding.scope.split('/');
                                              if (databaseId && containerId) {
                                                  inspectPartitions(databaseId, containerId);
                                              }
                                          },
                                      }
                                    : undefined
                            }
                        />
                    </div>
                )}
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
