/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@cosmosdb/webview-rpc/react';
import { makeStyles, Spinner, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    type AccountOverviewAppRouter,
    type AlertsResult,
    type AlertTimeRange,
    type DerivedAdvisoriesResult,
    type HealthState,
    type InventoryContainerRow,
    type InventoryMetricsResult,
    type MetricKey,
    type MetricSeriesResult,
    type PartitionDistributionMode,
    type PartitionHealthResult,
    type RecommendationsResult,
    type TimeRange,
    type UnavailableReason,
} from '../../api/types';
import { AccountHeader, type AccountSummary } from './AccountHeader';
import { ActiveAlerts } from './ActiveAlerts';
import { DashboardActionsProvider, DashboardCard, SectionHeader } from './DashboardChrome';
import { DerivedAdvisories } from './DerivedAdvisories';
import { InventoryTable } from './InventoryTable';
import { type ContainerRef, type MetricScope, METRIC_ORDER } from './metrics/descriptors';
import { MetricsSection } from './metrics/MetricsSection';
import { PartitionHealth } from './PartitionHealth';
import { Recommendations } from './Recommendations';

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
        // Stretch the two columns to a common height so the rail can match the taller main column (the rail's own
        // content never drives the row height because its growable card can shrink — see `advisoriesCard`).
        alignItems: 'stretch',
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
        // Allow the flex children to shrink below their content size so the growable advisories card can bound
        // itself and scroll internally instead of stretching the whole panel taller.
        minHeight: 0,
        maxWidth: '420px',
    },
    // The Derived Advisories card fills whatever vertical space is left in the rail after the fixed cards, matching
    // the main column's height. `flex: 1 1 0` + `minHeight: 0` lets it grow to fill yet shrink to nothing, so its
    // (potentially long) content never drives the row taller; the list scrolls inside it instead.
    advisoriesCard: {
        flex: '1 1 0',
        minHeight: 0,
        overflow: 'hidden',
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
    available: boolean;
    reason?: UnavailableReason;
    rows: InventoryContainerRow[];
};

export const AccountOverview = () => {
    const styles = useStyles();
    const { trpcClient } = useTrpcClient<AccountOverviewAppRouter>();

    const [summary, setSummary] = useState<AccountSummary | undefined>(undefined);
    const [inventory, setInventory] = useState<Inventory | undefined>(undefined);
    const [inventoryMetrics, setInventoryMetrics] = useState<InventoryMetricsResult | undefined>(undefined);
    const [trends, setTrends] = useState<Partial<Record<MetricKey, MetricSeriesResult>>>({});
    const [trendsLoading, setTrendsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<TimeRange>('24H');
    const [selectedContainer, setSelectedContainer] = useState<MetricScope | undefined>(undefined);
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
    // Monotonic id of the latest in-flight trends request; only that request may commit its result.
    const trendsRequestSeq = useRef(0);

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
        async (range: TimeRange, container?: MetricScope) => {
            // Guard against out-of-order responses: range/scope changes and manual refreshes can leave
            // several requests in flight, and a slower older one must not overwrite a newer result. Only
            // the most recently issued request is allowed to commit its state.
            const requestId = ++trendsRequestSeq.current;
            setTrendsLoading(true);
            try {
                // Load each metric independently: one failing request (transport/transient error) should
                // degrade just that tile to an unavailable placeholder, not reject the whole batch and
                // leave every tile stale via an unhandled rejection.
                const outcomes = await Promise.allSettled(
                    METRIC_ORDER.map(async (metric) => {
                        const result = await trpcClient.accountOverview.getMetricSeries.query({
                            metric,
                            timeRange: range,
                            databaseId: container?.databaseId,
                            containerId: container?.containerId,
                        });
                        return [metric, result] as const;
                    }),
                );
                if (requestId !== trendsRequestSeq.current) {
                    return;
                }
                const next: Partial<Record<MetricKey, MetricSeriesResult>> = {};
                METRIC_ORDER.forEach((metric, index) => {
                    const outcome = outcomes[index];
                    if (outcome.status === 'fulfilled') {
                        next[outcome.value[0]] = outcome.value[1];
                    } else {
                        next[metric] = {
                            metric,
                            available: false,
                            reason: 'noData',
                            points: [],
                            timeRange: range,
                            databaseId: container?.databaseId,
                            containerId: container?.containerId,
                            generatedAt: Date.now(),
                        };
                    }
                });
                setTrends(next);
                setLastRefreshedAt(Date.now());
            } finally {
                if (requestId === trendsRequestSeq.current) {
                    setTrendsLoading(false);
                }
            }
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
        void trpcClient.accountOverview.getInventory
            .query()
            .then((result: Inventory) => {
                if (!cancelled) {
                    setInventory(result);
                }
            })
            .catch(() => {
                // A transport-level failure (the router already shapes ARM/RBAC errors) must still
                // resolve the inventory state, otherwise the whole panel stays on the loading spinner.
                if (!cancelled) {
                    setInventory({ supported: true, available: false, reason: 'noData', rows: [] });
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

    // Mirror a container-scoped selection into the partition panel. The metrics scope dropdown only emits
    // account/database scope today (no container drill-in is wired), so this effect is currently inert but
    // kept so a future container-level selection flows through without extra plumbing.
    useEffect(() => {
        if (selectedContainer?.containerId) {
            setPartitionContainer({
                databaseId: selectedContainer.databaseId,
                containerId: selectedContainer.containerId,
            });
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

                        <MetricsSection
                            order={METRIC_ORDER}
                            seriesByMetric={trends}
                            loading={trendsLoading}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                            containers={containers}
                            selectedContainer={selectedContainer}
                            onSelectContainer={setSelectedContainer}
                        />

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
                                available={inventory.available}
                                reason={inventory.reason}
                                metrics={inventoryMetrics?.available ? inventoryMetrics.metrics : undefined}
                                onRevealInTree={handleRevealInTree}
                                onOpenQueryEditor={handleOpenQueryEditor}
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

                        <DashboardCard className={styles.advisoriesCard}>
                            <SectionHeader
                                title={l10n.t('Derived Advisories')}
                                description={l10n.t(
                                    "Advisories computed from this account's telemetry, not the Azure portal.",
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
