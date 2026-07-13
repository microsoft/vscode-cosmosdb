/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
import { makeStyles, Spinner, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    type AccountOverviewAppRouter,
    type AlertsResult,
    type AlertTimeRange,
    type DerivedAdvisoriesResult,
    type HealthState,
    type InventoryContainerRow,
    type InventoryMetricsResult,
    type PartitionDistributionMode,
    type PartitionHealthResult,
    type RecommendationsResult,
    type RuTrendsResult,
    type TimeRange,
} from '../../api/types';
import { AccountHeader, type AccountSummary } from './AccountHeader';
import { ActiveAlerts } from './ActiveAlerts';
import { DashboardActionsProvider, DashboardCard, SectionHeader } from './DashboardChrome';
import { DerivedAdvisories } from './DerivedAdvisories';
import { InventoryTable } from './InventoryTable';
import { PartitionHealth } from './PartitionHealth';
import { Recommendations } from './Recommendations';
import { type ContainerRef, RuTrendsChart } from './RuTrendsChart';
import { SummaryMetrics } from './SummaryMetrics';

const AUTO_REFRESH_INTERVAL_MS = 60_000;
/** Lightweight inventory metrics poll; staggered from the 60 s trends poll. */
const INVENTORY_REFRESH_INTERVAL_MS = 30_000;
/** Partition telemetry poll cadence (metric heatmaps refresh every 60 s). */
const PARTITION_REFRESH_INTERVAL_MS = 60_000;
/** Alerts + Advisor recommendations poll cadence. */
const RAIL_REFRESH_INTERVAL_MS = 60_000;

const HEALTH_ORDER: Record<HealthState, number> = { Healthy: 0, 'Needs Attention': 1, Critical: 2 };

/**
 * Final account-health formula: escalates the base health with
 * alert/recommendation signals — Sev0/Sev1 → Critical; Sev2/Sev3 or a
 * High-impact Perf/Cost rec → Needs Attention. Mirrors the host-side
 * `escalateAccountHealth` (unit-tested there).
 */
function escalateHealth(
    base: HealthState,
    signals: { hasCriticalAlert: boolean; hasWarningAlert: boolean; hasHighImpactPerfCostRec: boolean },
): HealthState {
    let signalHealth: HealthState = 'Healthy';
    if (signals.hasCriticalAlert) {
        signalHealth = 'Critical';
    } else if (signals.hasWarningAlert || signals.hasHighImpactPerfCostRec) {
        signalHealth = 'Needs Attention';
    }
    return HEALTH_ORDER[base] >= HEALTH_ORDER[signalHealth] ? base : signalHealth;
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        padding: tokens.spacingHorizontalXXL,
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        minHeight: '100vh',
        boxSizing: 'border-box',
    },
    layout: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
    },
    mainColumn: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        flex: '1 1 640px',
        minWidth: 0,
    },
    rail: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        flex: '1 1 300px',
        minWidth: 0,
        maxWidth: '420px',
    },
    loading: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
    },
});

type Inventory = {
    supported: boolean;
    rows: InventoryContainerRow[];
};

export const AccountOverview = () => {
    const styles = useStyles();
    const { trpcClient } = useTrpcClient<AccountOverviewAppRouter>();

    const [summary, setSummary] = useState<AccountSummary | undefined>(undefined);
    const [inventory, setInventory] = useState<Inventory | undefined>(undefined);
    const [inventoryMetrics, setInventoryMetrics] = useState<InventoryMetricsResult | undefined>(undefined);
    const [trends, setTrends] = useState<RuTrendsResult | undefined>(undefined);
    const [trendsLoading, setTrendsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<TimeRange>('24H');
    const [selectedContainer, setSelectedContainer] = useState<ContainerRef | undefined>(undefined);
    const [partitionMode, setPartitionMode] = useState<PartitionDistributionMode>('ru');
    const [partitionContainer, setPartitionContainer] = useState<ContainerRef | undefined>(undefined);
    const [partitionHealth, setPartitionHealth] = useState<PartitionHealthResult | undefined>(undefined);
    const [partitionLoading, setPartitionLoading] = useState(false);
    const [alerts, setAlerts] = useState<AlertsResult | undefined>(undefined);
    const [alertsLoading, setAlertsLoading] = useState(true);
    const [alertTimeRange, setAlertTimeRange] = useState<AlertTimeRange>('1d');
    const [recommendations, setRecommendations] = useState<RecommendationsResult | undefined>(undefined);
    const [recommendationsLoading, setRecommendationsLoading] = useState(true);
    const [derivedAdvisories, setDerivedAdvisories] = useState<DerivedAdvisoriesResult | undefined>(undefined);
    const [derivedLoading, setDerivedLoading] = useState(true);
    const [dismissedAdvisoryIds, setDismissedAdvisoryIds] = useState<ReadonlySet<string>>(() => new Set());
    const [paused, setPaused] = useState(false);
    const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());

    const reportEvent = useCallback(
        (eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>) => {
            void trpcClient.accountOverview.reportEvent.mutate({ eventName, properties, measurements });
        },
        [trpcClient],
    );

    const fetchSummary = useCallback(() => {
        return trpcClient.accountOverview.getAccountSummary.query().then((result: AccountSummary) => {
            setSummary(result);
        });
    }, [trpcClient]);

    const fetchTrends = useCallback(
        (range: TimeRange, container?: ContainerRef) => {
            setTrendsLoading(true);
            return trpcClient.accountOverview.getRuTrends
                .query({
                    timeRange: range,
                    databaseId: container?.databaseId,
                    containerId: container?.containerId,
                })
                .then((result: RuTrendsResult) => {
                    setTrends(result);
                    setLastRefreshedAt(Date.now());
                })
                .finally(() => setTrendsLoading(false));
        },
        [trpcClient],
    );

    const fetchInventoryMetrics = useCallback(
        (range: TimeRange) => {
            return trpcClient.accountOverview.getInventoryMetrics
                .query({ timeRange: range })
                .then((result: InventoryMetricsResult) => {
                    setInventoryMetrics(result);
                });
        },
        [trpcClient],
    );

    const fetchPartitionHealth = useCallback(
        (container: ContainerRef, mode: PartitionDistributionMode, range: TimeRange) => {
            setPartitionLoading(true);
            return trpcClient.accountOverview.getPartitionHealth
                .query({
                    timeRange: range,
                    databaseId: container.databaseId,
                    containerId: container.containerId,
                    mode,
                })
                .then((result: PartitionHealthResult) => {
                    setPartitionHealth(result);
                })
                .finally(() => setPartitionLoading(false));
        },
        [trpcClient],
    );

    const fetchAlerts = useCallback(
        (range: AlertTimeRange) => {
            setAlertsLoading(true);
            return trpcClient.accountOverview.getAlerts
                .query({ timeRange: range })
                .then((result: AlertsResult) => {
                    setAlerts(result);
                })
                .finally(() => setAlertsLoading(false));
        },
        [trpcClient],
    );

    const fetchRecommendations = useCallback(() => {
        setRecommendationsLoading(true);
        return trpcClient.accountOverview.getRecommendations
            .query()
            .then((result: RecommendationsResult) => {
                setRecommendations(result);
            })
            .finally(() => setRecommendationsLoading(false));
    }, [trpcClient]);

    const fetchDerivedAdvisories = useCallback(() => {
        setDerivedLoading(true);
        return trpcClient.accountOverview.getDerivedAdvisories
            .query()
            .then((result: DerivedAdvisoriesResult) => {
                setDerivedAdvisories(result);
            })
            .finally(() => setDerivedLoading(false));
    }, [trpcClient]);

    const handleDismissAdvisory = useCallback((id: string) => {
        setDismissedAdvisoryIds((previous) => new Set(previous).add(id));
    }, []);

    // One-time inventory load (static metadata; refreshed manually only).
    useEffect(() => {
        let cancelled = false;
        void fetchSummary();
        void trpcClient.accountOverview.getInventory.query().then((result: Inventory) => {
            if (!cancelled) {
                setInventory(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [trpcClient, fetchSummary]);

    // Reload trends whenever the time range or selected container changes.
    useEffect(() => {
        void fetchTrends(timeRange, selectedContainer);
    }, [fetchTrends, timeRange, selectedContainer]);

    // Reload inventory metrics whenever the time range changes (drives the peak column window).
    useEffect(() => {
        void fetchInventoryMetrics(timeRange);
    }, [fetchInventoryMetrics, timeRange]);

    // Default the partition-health container to the first inventory row.
    useEffect(() => {
        if (!partitionContainer && inventory && inventory.rows.length > 0) {
            const first = inventory.rows[0];
            setPartitionContainer({ databaseId: first.databaseId, containerId: first.containerId });
        }
    }, [inventory, partitionContainer]);

    // Keep the partition container synchronized with the inventory/chart selection.
    useEffect(() => {
        if (selectedContainer) {
            setPartitionContainer(selectedContainer);
        }
    }, [selectedContainer]);

    // Reload partition health whenever the container, measure, or time range changes.
    useEffect(() => {
        if (!partitionContainer) {
            return;
        }
        setPartitionHealth(undefined);
        void fetchPartitionHealth(partitionContainer, partitionMode, timeRange);
    }, [fetchPartitionHealth, partitionContainer, partitionMode, timeRange]);

    // Reload alerts whenever the alert time-range filter changes.
    useEffect(() => {
        void fetchAlerts(alertTimeRange);
    }, [fetchAlerts, alertTimeRange]);

    // One-time recommendations load (subscription-wide Advisor call; polled below).
    useEffect(() => {
        void fetchRecommendations();
    }, [fetchRecommendations]);

    // One-time derived-advisories load (host-side derived-advisory engine over already-fetched telemetry; polled below).
    useEffect(() => {
        void fetchDerivedAdvisories();
    }, [fetchDerivedAdvisories]);

    const refresh = useCallback(() => {
        reportEvent('refreshTicked', { windowSize: timeRange });
        void fetchSummary();
        void fetchTrends(timeRange, selectedContainer);
        void fetchAlerts(alertTimeRange);
        void fetchRecommendations();
        void fetchDerivedAdvisories();
    }, [
        reportEvent,
        fetchSummary,
        fetchTrends,
        timeRange,
        selectedContainer,
        fetchAlerts,
        alertTimeRange,
        fetchRecommendations,
        fetchDerivedAdvisories,
    ]);

    // Auto-refresh: poll every 60s, but only while the panel is visible and not
    // paused. Resume immediately when the panel becomes visible again.
    useEffect(() => {
        if (paused) {
            return;
        }
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, AUTO_REFRESH_INTERVAL_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [paused, refresh]);

    // Lightweight inventory-metrics poll (30s), staggered by half an interval from the 60s
    // trends poll, gated on visibility and the pause toggle just like the trends refresh.
    useEffect(() => {
        if (paused) {
            return;
        }
        const poll = () => {
            if (document.visibilityState === 'visible') {
                void fetchInventoryMetrics(timeRange);
            }
        };
        const stagger: { intervalId?: ReturnType<typeof setInterval> } = {};
        const startTimeout = setTimeout(() => {
            poll();
            stagger.intervalId = setInterval(poll, INVENTORY_REFRESH_INTERVAL_MS);
        }, INVENTORY_REFRESH_INTERVAL_MS / 2);
        const onVisibilityChange = () => poll();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            clearTimeout(startTimeout);
            if (stagger.intervalId) {
                clearInterval(stagger.intervalId);
            }
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [paused, fetchInventoryMetrics, timeRange]);

    // Partition telemetry poll (60s), gated on visibility and the pause toggle.
    useEffect(() => {
        if (paused || !partitionContainer) {
            return;
        }
        const poll = () => {
            if (document.visibilityState === 'visible') {
                void fetchPartitionHealth(partitionContainer, partitionMode, timeRange);
            }
        };
        const intervalId = setInterval(poll, PARTITION_REFRESH_INTERVAL_MS);
        const onVisibilityChange = () => poll();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [paused, partitionContainer, partitionMode, timeRange, fetchPartitionHealth]);

    // Alerts + Advisor recommendations poll (60s), gated on visibility and pause.
    // The Advisor call is shared subscription-wide on the host, so multiple open
    // dashboards coalesce into one ARM read per tick.
    useEffect(() => {
        if (paused) {
            return;
        }
        const poll = () => {
            if (document.visibilityState === 'visible') {
                void fetchAlerts(alertTimeRange);
                void fetchRecommendations();
                void fetchDerivedAdvisories();
            }
        };
        const intervalId = setInterval(poll, RAIL_REFRESH_INTERVAL_MS);
        const onVisibilityChange = () => poll();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [paused, alertTimeRange, fetchAlerts, fetchRecommendations, fetchDerivedAdvisories]);

    const handleOpenUrl = useCallback(
        (url: string) => {
            void trpcClient.accountOverview.openUrl.mutate({ url });
        },
        [trpcClient],
    );

    const handleRevealInTree = useCallback(
        (databaseId: string, containerId: string) => {
            reportEvent('deepLinkFollowed', { target: 'tree' });
            void trpcClient.accountOverview.revealInTree.mutate({ databaseId, containerId });
        },
        [trpcClient, reportEvent],
    );

    const handleOpenQueryEditor = useCallback(
        (databaseId: string, containerId: string) => {
            reportEvent('deepLinkFollowed', { target: 'dataExplorer' });
            void trpcClient.accountOverview.openQueryEditor.mutate({ databaseId, containerId });
        },
        [trpcClient, reportEvent],
    );

    const handleShowInChart = useCallback(
        (databaseId: string, containerId: string) => {
            reportEvent('drillInOpened', { target: 'container' });
            setSelectedContainer({ databaseId, containerId });
        },
        [reportEvent],
    );

    const handleSelectPartitionContainer = useCallback(
        (container: ContainerRef) => {
            reportEvent('drillInOpened', { target: 'partition' });
            setPartitionContainer(container);
        },
        [reportEvent],
    );

    const actions = useMemo(() => ({ reportEvent, openUrl: handleOpenUrl }), [reportEvent, handleOpenUrl]);

    if (!summary || !inventory) {
        return (
            <div className={styles.loading}>
                <Spinner label={l10n.t('Loading…')} />
            </div>
        );
    }

    const containers: ContainerRef[] = inventory.rows.map((row) => ({
        databaseId: row.databaseId,
        containerId: row.containerId,
    }));

    const baseHealth = inventoryMetrics?.accountHealth;
    const healthSignals = {
        hasCriticalAlert: alerts?.available ? alerts.criticalCount > 0 : false,
        hasWarningAlert: alerts?.available ? alerts.warningCount > 0 : false,
        hasHighImpactPerfCostRec: recommendations?.available ? recommendations.hasHighImpactPerfCost : false,
    };
    const anySignal =
        healthSignals.hasCriticalAlert || healthSignals.hasWarningAlert || healthSignals.hasHighImpactPerfCostRec;
    const accountHealth =
        baseHealth !== undefined
            ? escalateHealth(baseHealth, healthSignals)
            : anySignal
              ? escalateHealth('Healthy', healthSignals)
              : undefined;

    return (
        <DashboardActionsProvider value={actions}>
            <div className={styles.root}>
                <div className={styles.layout}>
                    <div className={styles.mainColumn}>
                        <DashboardCard>
                            <AccountHeader
                                summary={summary}
                                accountHealth={accountHealth}
                                lastRefreshedAt={lastRefreshedAt}
                                paused={paused}
                                onTogglePause={setPaused}
                                onRefresh={refresh}
                                autoRefreshIntervalsSeconds={{
                                    metrics: AUTO_REFRESH_INTERVAL_MS / 1000,
                                    inventory: INVENTORY_REFRESH_INTERVAL_MS / 1000,
                                    alerts: RAIL_REFRESH_INTERVAL_MS / 1000,
                                }}
                            />
                        </DashboardCard>

                        <SummaryMetrics rows={inventory.rows} supported={inventory.supported} trends={trends} />

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Recent RU Usage Trends')}
                                description={l10n.t(
                                    'Consumed throughput versus the provisioned ceiling, with throttling windows highlighted.',
                                )}
                            />
                            <RuTrendsChart
                                trends={trends}
                                loading={trendsLoading}
                                timeRange={timeRange}
                                onTimeRangeChange={setTimeRange}
                                containers={containers}
                                selected={selectedContainer}
                                onSelectContainer={setSelectedContainer}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Databases and Containers')}
                                description={l10n.t(
                                    'Throughput mode, partition key, and indexing posture per container.',
                                )}
                            />
                            <InventoryTable
                                rows={inventory.rows}
                                supported={inventory.supported}
                                metrics={inventoryMetrics?.available ? inventoryMetrics.metrics : undefined}
                                onRevealInTree={handleRevealInTree}
                                onOpenQueryEditor={handleOpenQueryEditor}
                                onShowInChart={handleShowInChart}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Partition Key Distribution Health')}
                                description={l10n.t(
                                    'Physical-partition RU and storage distribution for the selected container, with hot partitions flagged.',
                                )}
                            />
                            <PartitionHealth
                                result={partitionHealth}
                                loading={partitionLoading}
                                mode={partitionMode}
                                onModeChange={setPartitionMode}
                                containers={containers}
                                selected={partitionContainer}
                                onSelectContainer={handleSelectPartitionContainer}
                            />
                        </DashboardCard>
                    </div>

                    <aside className={styles.rail} aria-label={l10n.t('Alerts and recommendations')}>
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Active Alerts')}
                                description={l10n.t('Fired Azure Monitor alerts targeting this account.')}
                            />
                            <ActiveAlerts
                                result={alerts}
                                loading={alertsLoading}
                                timeRange={alertTimeRange}
                                onTimeRangeChange={setAlertTimeRange}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Recommendations')}
                                description={l10n.t('Azure Advisor guidance for this account.')}
                            />
                            <Recommendations
                                result={recommendations}
                                loading={recommendationsLoading}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>

                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Derived Advisories')}
                                description={l10n.t(
                                    'Advisories computed from this account’s telemetry, not the Azure portal.',
                                )}
                            />
                            <DerivedAdvisories
                                result={derivedAdvisories}
                                loading={derivedLoading}
                                dismissedIds={dismissedAdvisoryIds}
                                onDismiss={handleDismissAdvisory}
                            />
                        </DashboardCard>
                    </aside>
                </div>
            </div>
        </DashboardActionsProvider>
    );
};
