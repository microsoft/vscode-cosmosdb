/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, tokens, typographyStyles, useAnnounce } from '@fluentui/react-components';
import { useRpcEvents, useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveOverviewHealth } from '../../../panels/accountOverview/overviewHealthModel';
import {
    type AccountActionInput,
    type AccountOverviewAppRouter,
    type AccountOverviewTarget,
    type AlertMonitorCondition,
    type AlertsResult,
    type AlertTimeRange,
    type DerivedAdvisoriesResult,
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
import { AccountActions, type AccountActionFailure } from './AccountActions';
import { AccountHeader, type AccountSummary } from './AccountHeader';
import { healthIndicatorDescriptions } from './AccountHealthStatus';
import { ActiveAlerts } from './ActiveAlerts';
import { DashboardActionsProvider, DashboardCard, SectionHeader } from './DashboardChrome';
import { DerivedAdvisories } from './DerivedAdvisories';
import { InventoryTable } from './InventoryTable';
import { type ContainerRef, type MetricScope, METRIC_ORDER } from './metrics/descriptors';
import { MetricsSection } from './metrics/MetricsSection';
import { PartitionHealth } from './PartitionHealth';
import { Recommendations } from './Recommendations';
import { type OverviewTab, TabbedOverviewLayout } from './TabbedOverviewLayout';
import { useOverviewHealthSignals } from './useOverviewHealthSignals';
import { useOverviewNavigation } from './useOverviewNavigation';

const NATIVE_ERROR_ACTIONS = new Set([
    'accountOverview.openUrl',
    'accountOverview.showOutput',
    'accountOverview.revealInTree',
    'accountOverview.openQueryEditor',
    'accountOverview.provideFeedback',
]);

async function runAuxiliaryAction(action: () => Promise<unknown>): Promise<void> {
    try {
        await action();
    } catch {
        // The RPC event subscriber owns native error notification; do not display or rethrow it again here.
    }
}

const useStyles = makeStyles({
    root: {
        ...typographyStyles.body1,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
        padding: tokens.spacingHorizontalXXL,
        color: tokens.colorNeutralForeground1,
        backgroundColor: tokens.colorNeutralBackground1,
        minHeight: '100vh',
        boxSizing: 'border-box',
    },
    loading: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
    },
    creationOverlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000001,
        backgroundColor: tokens.colorBackgroundOverlay,
        cursor: 'wait',
    },
});

type Inventory = {
    supported: boolean;
    available: boolean;
    reason?: UnavailableReason;
    rows: InventoryContainerRow[];
    databases?: string[];
};

export const AccountOverview = () => {
    const { navigation, failed, retry } = useOverviewNavigation();
    const [accountDeleted, setAccountDeleted] = useState(false);
    return (
        <>
            {failed && (
                <div role="alert">
                    <p>{l10n.t('Account Overview navigation could not be loaded.')}</p>
                    <Button onClick={retry}>{l10n.t('Retry')}</Button>
                </div>
            )}
            {!navigation && !failed && <Spinner label={l10n.t('Loading Account Overview…')} />}
            {accountDeleted && <output>{l10n.t('This Cosmos DB account has been deleted.')}</output>}
            {navigation && !accountDeleted && (
                <OverviewDashboard
                    requestedTarget={navigation.target}
                    navigationRevision={navigation.revision}
                    onAccountDeleted={() => setAccountDeleted(true)}
                />
            )}
        </>
    );
};

export const OverviewDashboard = ({
    requestedTarget = 'overview',
    navigationRevision = 0,
    onAccountDeleted,
}: {
    requestedTarget?: AccountOverviewTarget;
    navigationRevision?: number;
    onAccountDeleted: () => void;
}) => {
    const styles = useStyles();
    const trpcClient = useTrpcClient<AccountOverviewAppRouter>();
    const rpcEvents = useRpcEvents();
    const { announce } = useAnnounce();
    const [isAIFeaturesEnabled, setIsAIFeaturesEnabled] = useState(false);
    const [feedbackEnabled, setFeedbackEnabled] = useState(false);
    const [isDataModelerEnabled, setIsDataModelerEnabled] = useState(false);

    useEffect(() => {
        const subscription = trpcClient.accountOverview.feedbackEnabled.subscribe(undefined, {
            onData: setFeedbackEnabled,
            onError: (error) => {
                setFeedbackEnabled(false);
                console.error('Unable to receive Account Overview feedback availability.', error);
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

    useEffect(() => {
        const subscription = trpcClient.accountOverview.dataModelerEnabled.subscribe(undefined, {
            onData: setIsDataModelerEnabled,
            onError: (error) => {
                setIsDataModelerEnabled(false);
                console.error('Unable to receive Account Overview Data Modeler availability.', error);
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

    useEffect(() => {
        const subscription = trpcClient.accountOverview.aiFeaturesEnabled.subscribe(undefined, {
            onData: setIsAIFeaturesEnabled,
            onError: (error) => {
                setIsAIFeaturesEnabled(false);
                console.error('Unable to receive Account Overview AI feature availability.', error);
            },
        });
        return () => subscription.unsubscribe();
    }, [trpcClient]);

    useEffect(
        () =>
            rpcEvents.onError((error, info) => {
                if (info.type === 'mutation' && NATIVE_ERROR_ACTIONS.has(info.path)) {
                    void trpcClient.accountOverview.showErrorMessage
                        .mutate({ message: error.message })
                        .catch((error: unknown) => {
                            // Do not send notification failures back through the notification route.
                            console.error('Unable to display Account Overview action error.', error);
                        });
                }
            }),
        [rpcEvents, trpcClient],
    );

    const requestedTab = requestedTarget === 'advisories' ? 'advisories' : 'monitoring';
    const [selectedTab, setSelectedTab] = useState<OverviewTab>(requestedTab);
    useEffect(() => setSelectedTab(requestedTab), [requestedTab, requestedTarget, navigationRevision]);
    const [summary, setSummary] = useState<AccountSummary | undefined>(undefined);
    const [inventory, setInventory] = useState<Inventory | undefined>(undefined);
    const [inventoryMetrics, setInventoryMetrics] = useState<InventoryMetricsResult | undefined>(undefined);
    const [inventoryMetricsLoading, setInventoryMetricsLoading] = useState(true);
    const [trends, setTrends] = useState<Partial<Record<MetricKey, MetricSeriesResult>>>({});
    const [trendsLoading, setTrendsLoading] = useState(true);
    const [timeRange, setTimeRange] = useState<TimeRange>('24H');
    const [selectedContainer, setSelectedContainer] = useState<MetricScope | undefined>(undefined);
    const [selectedPartitionMode, setPartitionMode] = useState<PartitionDistributionMode>('ru');
    const normalizedRuApplicability = summary?.metricApplicability.normalizedRu;
    const normalizedRuStatus = normalizedRuApplicability?.status;
    const partitionMode = normalizedRuApplicability?.status === 'notApplicable' ? 'storage' : selectedPartitionMode;
    const [partitionContainer, setPartitionContainer] = useState<ContainerRef | undefined>(undefined);
    const [partitionHealth, setPartitionHealth] = useState<PartitionHealthResult | undefined>(undefined);
    const [partitionLoading, setPartitionLoading] = useState(false);
    const [alerts, setAlerts] = useState<AlertsResult | undefined>(undefined);
    const [alertsLoading, setAlertsLoading] = useState(true);
    const [alertTimeRange, setAlertTimeRange] = useState<AlertTimeRange>('1d');
    const [alertMonitorCondition, setAlertMonitorCondition] = useState<AlertMonitorCondition>('Fired');
    const [recommendations, setRecommendations] = useState<RecommendationsResult | undefined>(undefined);
    const [recommendationsLoading, setRecommendationsLoading] = useState(true);
    const [derivedAdvisories, setDerivedAdvisories] = useState<DerivedAdvisoriesResult | undefined>(undefined);
    const [derivedLoading, setDerivedLoading] = useState(true);
    const [dismissedAdvisoryIds, setDismissedAdvisoryIds] = useState<ReadonlySet<string>>(() => new Set());
    const [lastRefreshedAt, setLastRefreshedAt] = useState<number>();
    const [refreshing, setRefreshing] = useState(false);
    const refreshInFlight = useRef(false);
    const [userUpdatePending, setUserUpdatePending] = useState(false);
    const [pendingAccountAction, setPendingAccountAction] = useState<AccountActionInput['action']>();
    const accountActionBusy = pendingAccountAction !== undefined;
    const creationBusy = pendingAccountAction === 'createDatabase' || pendingAccountAction === 'createContainer';
    const [accountActionFailure, setAccountActionFailure] = useState<AccountActionFailure>();
    const handleHealthError = useCallback(() => setAccountActionFailure('refresh'), []);
    const {
        account: accountHealthResult,
        accountLoading: accountHealthLoading,
        activeAlerts,
        activeAlertsLoading,
        activeAlertsUnavailable,
        refresh: refreshHealthSignals,
    } = useOverviewHealthSignals(trpcClient, handleHealthError);
    const accountActionInFlight = useRef(false);
    const creationTrigger = useRef<HTMLElement | undefined>(undefined);
    const inventoryRequestSeq = useRef(0);
    const inventoryMetricsRequestSeq = useRef(0);
    // Monotonic id of the latest in-flight trends request; only that request may commit its result.
    const trendsRequestSeq = useRef(0);
    const partitionRequestSeq = useRef(0);
    const alertsRequestSeq = useRef(0);
    const headerLoading =
        refreshing ||
        trendsLoading ||
        inventoryMetricsLoading ||
        accountHealthLoading ||
        partitionLoading ||
        alertsLoading ||
        activeAlertsLoading ||
        recommendationsLoading ||
        derivedLoading;
    const headerUpdating =
        refreshing || (userUpdatePending && (trendsLoading || inventoryMetricsLoading || partitionLoading));

    const beginHeaderUpdate = useCallback(() => {
        if (!userUpdatePending) {
            announce(l10n.t('Updating Account Overview…'), { polite: true });
        }
        setUserUpdatePending(true);
        setAccountActionFailure((failure) => (failure === 'refresh' ? undefined : failure));
    }, [announce, userUpdatePending]);

    useEffect(() => {
        if (userUpdatePending && !headerUpdating) {
            setUserUpdatePending(false);
            announce(l10n.t('Account Overview update finished.'), { polite: true });
        }
    }, [userUpdatePending, headerUpdating, announce]);

    useEffect(() => {
        if (accountActionBusy) {
            announce(l10n.t('Account action in progress…'), { polite: true });
        }
    }, [accountActionBusy, announce]);

    useEffect(() => {
        if (!creationBusy && creationTrigger.current) {
            const trigger = creationTrigger.current;
            creationTrigger.current = undefined;
            // Do not take focus back from another VS Code editor or the native wizard.
            if (trigger.isConnected && document.hasFocus()) {
                trigger.focus({ preventScroll: true });
            }
        }
    }, [creationBusy]);

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

    const fetchInventory = useCallback(async () => {
        const requestId = ++inventoryRequestSeq.current;
        const result = await trpcClient.accountOverview.getInventory.query();
        if (requestId === inventoryRequestSeq.current) {
            setInventory(result);
        }
        return result;
    }, [trpcClient]);

    const reloadInventory = useCallback(async () => {
        try {
            const result = await fetchInventory();
            if (!result.available) {
                setAccountActionFailure('refresh');
            } else {
                setAccountActionFailure((failure) => (failure === 'refresh' ? undefined : failure));
            }
        } catch {
            setAccountActionFailure('refresh');
        }
    }, [fetchInventory]);

    const runAccountAction = useCallback(
        async (input: AccountActionInput) => {
            if (accountActionInFlight.current) {
                return;
            }
            accountActionInFlight.current = true;
            if (input.action === 'createDatabase' || input.action === 'createContainer') {
                creationTrigger.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
            }
            setPendingAccountAction(input.action);
            setAccountActionFailure(undefined);
            try {
                const result = await trpcClient.accountOverview.runAccountAction.mutate(input);
                if (result.status === 'cancelled') {
                    return;
                }
                if (input.action === 'deleteAccount') {
                    onAccountDeleted();
                } else if (input.action === 'createDatabase' || input.action === 'createContainer') {
                    await reloadInventory();
                }
            } catch {
                setAccountActionFailure('action');
            } finally {
                accountActionInFlight.current = false;
                setPendingAccountAction(undefined);
            }
        },
        [trpcClient, reloadInventory, onAccountDeleted],
    );

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
                            applicability: { status: 'unknown' },
                            available: false,
                            reason: 'error',
                            points: [],
                            timeRange: range,
                            databaseId: container?.databaseId,
                            containerId: container?.containerId,
                            generatedAt: Date.now(),
                        };
                    }
                });
                setTrends(next);
                setLastRefreshedAt(Object.values(next).some((series) => series.available) ? Date.now() : undefined);
            } finally {
                if (requestId === trendsRequestSeq.current) {
                    setTrendsLoading(false);
                }
            }
        },
        [trpcClient],
    );

    const fetchInventoryMetrics = useCallback(
        async (range: TimeRange) => {
            const requestId = ++inventoryMetricsRequestSeq.current;
            setInventoryMetricsLoading(true);
            try {
                const result = await trpcClient.accountOverview.getInventoryMetrics.query({ timeRange: range });
                if (requestId === inventoryMetricsRequestSeq.current) {
                    setInventoryMetrics(result);
                }
                return true;
            } catch {
                if (requestId === inventoryMetricsRequestSeq.current) {
                    setInventoryMetrics(undefined);
                    setAccountActionFailure('refresh');
                }
                return false;
            } finally {
                if (requestId === inventoryMetricsRequestSeq.current) {
                    setInventoryMetricsLoading(false);
                }
            }
        },
        [trpcClient],
    );

    const fetchPartitionHealth = useCallback(
        (container: ContainerRef, mode: PartitionDistributionMode, range: TimeRange) => {
            const requestId = ++partitionRequestSeq.current;
            setPartitionLoading(true);
            return trpcClient.accountOverview.getPartitionHealth
                .query({
                    timeRange: range,
                    databaseId: container.databaseId,
                    containerId: container.containerId,
                    mode,
                })
                .then((result: PartitionHealthResult) => {
                    if (requestId === partitionRequestSeq.current) {
                        setPartitionHealth(result);
                    }
                    return true;
                })
                .catch(() => {
                    if (requestId === partitionRequestSeq.current) {
                        setPartitionHealth({
                            available: false,
                            reason: 'error',
                            mode,
                            databaseId: container.databaseId,
                            containerId: container.containerId,
                            tiles: [],
                            skewScore: 0,
                            topPartitionShare: 0,
                            partitionCount: 0,
                            topN: 0,
                            generatedAt: Date.now(),
                        });
                        setAccountActionFailure('refresh');
                    }
                    return false;
                })
                .finally(() => {
                    if (requestId === partitionRequestSeq.current) {
                        setPartitionLoading(false);
                    }
                });
        },
        [trpcClient],
    );

    const fetchAlerts = useCallback(
        async (range: AlertTimeRange, monitorCondition: AlertMonitorCondition) => {
            const requestId = ++alertsRequestSeq.current;
            setAlertsLoading(true);
            let succeeded = true;
            const readAlerts = async (condition: AlertMonitorCondition): Promise<AlertsResult> => {
                try {
                    return await trpcClient.accountOverview.getAlerts.query({
                        timeRange: range,
                        monitorCondition: condition,
                    });
                } catch {
                    succeeded = false;
                    if (requestId === alertsRequestSeq.current) {
                        setAccountActionFailure('refresh');
                    }
                    return {
                        available: false,
                        reason: 'noData',
                        alerts: [],
                        criticalCount: 0,
                        warningCount: 0,
                        timeRange: range,
                        monitorCondition: condition,
                        generatedAt: Date.now(),
                    };
                }
            };
            try {
                const result = await readAlerts(monitorCondition);
                if (requestId === alertsRequestSeq.current) {
                    setAlerts(result);
                }
                return succeeded;
            } finally {
                if (requestId === alertsRequestSeq.current) {
                    setAlertsLoading(false);
                }
            }
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
        void fetchInventory().catch(() => {
            // A transport-level failure (the router already shapes ARM/RBAC errors) must still
            // resolve the inventory state, otherwise the whole panel stays on the loading spinner.
            if (!cancelled) {
                setInventory({ supported: true, available: false, reason: 'noData', rows: [] });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [fetchInventory, fetchSummary]);

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
        if (!partitionContainer || !normalizedRuStatus || normalizedRuStatus === 'unknown') {
            return;
        }
        setPartitionHealth(undefined);
        void fetchPartitionHealth(partitionContainer, partitionMode, timeRange);
    }, [fetchPartitionHealth, partitionContainer, partitionMode, timeRange, normalizedRuStatus]);

    // Only the displayed list follows the alert filters; health uses the independent Resource Graph summary.
    useEffect(() => {
        void fetchAlerts(alertTimeRange, alertMonitorCondition);
        return () => {
            // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate all requests, including a later Refresh.
            alertsRequestSeq.current++;
        };
    }, [fetchAlerts, alertTimeRange, alertMonitorCondition]);

    // Initial recommendations load; subsequent loads are requested by Refresh.
    useEffect(() => {
        void fetchRecommendations();
    }, [fetchRecommendations]);

    // Initial advisory collection and calculation; subsequent runs are requested by Refresh.
    useEffect(() => {
        void fetchDerivedAdvisories();
    }, [fetchDerivedAdvisories]);

    const refresh = useCallback(() => {
        reportEvent('refreshTicked', { windowSize: timeRange });
        return Promise.allSettled([
            fetchSummary(),
            fetchTrends(timeRange, selectedContainer),
            fetchAlerts(alertTimeRange, alertMonitorCondition),
            fetchRecommendations(),
            fetchDerivedAdvisories(),
        ]).then((outcomes) => {
            const succeeded = outcomes.every((outcome) => outcome.status === 'fulfilled' && outcome.value !== false);
            if (!succeeded) {
                setAccountActionFailure('refresh');
            }
            return succeeded;
        });
    }, [
        reportEvent,
        fetchSummary,
        fetchTrends,
        timeRange,
        selectedContainer,
        fetchAlerts,
        alertTimeRange,
        alertMonitorCondition,
        fetchRecommendations,
        fetchDerivedAdvisories,
    ]);

    const refreshAccount = useCallback(async () => {
        if (refreshInFlight.current) {
            return;
        }
        refreshInFlight.current = true;
        setRefreshing(true);
        beginHeaderUpdate();
        try {
            const outcomes = await Promise.allSettled([
                refresh(),
                fetchInventory(),
                fetchInventoryMetrics(timeRange),
                refreshHealthSignals(),
                ...(partitionContainer ? [fetchPartitionHealth(partitionContainer, partitionMode, timeRange)] : []),
            ]);
            const inventoryOutcome = outcomes[1];
            if (
                outcomes.some((outcome) => outcome.status === 'rejected' || outcome.value === false) ||
                (inventoryOutcome.status === 'fulfilled' &&
                    typeof inventoryOutcome.value === 'object' &&
                    !inventoryOutcome.value.available)
            ) {
                setAccountActionFailure('refresh');
            }
        } finally {
            refreshInFlight.current = false;
            setRefreshing(false);
        }
    }, [
        beginHeaderUpdate,
        refresh,
        fetchInventory,
        fetchInventoryMetrics,
        refreshHealthSignals,
        fetchPartitionHealth,
        timeRange,
        partitionContainer,
        partitionMode,
    ]);

    const handleTimeRangeChange = useCallback(
        (range: TimeRange) => {
            if (range === timeRange) {
                return;
            }
            beginHeaderUpdate();
            setTrendsLoading(true);
            setInventoryMetricsLoading(true);
            setTimeRange(range);
        },
        [beginHeaderUpdate, timeRange],
    );

    const handleScopeChange = useCallback(
        (scope?: MetricScope) => {
            if (
                scope?.databaseId === selectedContainer?.databaseId &&
                scope?.containerId === selectedContainer?.containerId
            ) {
                return;
            }
            beginHeaderUpdate();
            setTrendsLoading(true);
            setSelectedContainer(scope);
        },
        [beginHeaderUpdate, selectedContainer],
    );

    const handleOpenUrl = useCallback(
        (url: string) => {
            void runAuxiliaryAction(() => trpcClient.accountOverview.openUrl.mutate({ url }));
        },
        [trpcClient],
    );

    const handleShowOutput = useCallback(() => {
        void runAuxiliaryAction(() => trpcClient.accountOverview.showOutput.mutate());
    }, [trpcClient]);

    const handleRevealInTree = useCallback(
        (databaseId: string, containerId: string) => {
            reportEvent('deepLinkFollowed', { target: 'tree' });
            void runAuxiliaryAction(() => trpcClient.accountOverview.revealInTree.mutate({ databaseId, containerId }));
        },
        [trpcClient, reportEvent],
    );

    const handleOpenQueryEditor = useCallback(
        (databaseId: string, containerId: string) => {
            reportEvent('deepLinkFollowed', { target: 'dataExplorer' });
            void runAuxiliaryAction(() =>
                trpcClient.accountOverview.openQueryEditor.mutate({ databaseId, containerId }),
            );
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

    const handleAlertTimeRangeChange = useCallback(
        (range: AlertTimeRange) => {
            if (alertsLoading || refreshInFlight.current || range === alertTimeRange) {
                return;
            }
            setAlertsLoading(true);
            setAlertTimeRange(range);
        },
        [alertsLoading, alertTimeRange],
    );

    const handleAlertMonitorConditionChange = useCallback(
        (condition: AlertMonitorCondition) => {
            if (alertsLoading || refreshInFlight.current || condition === alertMonitorCondition) {
                return;
            }
            setAlertsLoading(true);
            setAlertMonitorCondition(condition);
        },
        [alertsLoading, alertMonitorCondition],
    );

    const actions = useMemo(
        () => ({ reportEvent, openUrl: handleOpenUrl, showOutput: handleShowOutput }),
        [reportEvent, handleOpenUrl, handleShowOutput],
    );

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

    const health = deriveOverviewHealth({
        account: accountHealthResult,
        accountLoading: accountHealthLoading,
        activeAlerts,
        activeAlertsLoading,
        activeAlertsUnavailable,
        inventory,
        inventoryMetrics,
        inventoryMetricsLoading,
        normalizedRuApplicability,
        recommendations,
        recommendationsLoading,
    });

    return (
        <DashboardActionsProvider value={actions}>
            <div className={styles.root} inert={creationBusy} aria-busy={creationBusy}>
                <TabbedOverviewLayout
                    requestedTab={
                        requestedTarget === 'overview' || requestedTarget === 'advisories' ? requestedTab : undefined
                    }
                    navigationRevision={navigationRevision}
                    selectedTab={selectedTab}
                    onTabSelect={setSelectedTab}
                    healthIndicators={healthIndicatorDescriptions(health.indicators)}
                    header={
                        <>
                            <AccountHeader
                                navigationRevision={navigationRevision}
                                summary={summary}
                                accountHealth={health.health}
                                healthChecks={health.checks}
                                activeAlertsUnavailable={activeAlertsUnavailable}
                                lastRefreshedAt={lastRefreshedAt}
                                onRefresh={() => void refreshAccount()}
                                onProvideFeedback={
                                    feedbackEnabled
                                        ? () =>
                                              runAuxiliaryAction(() =>
                                                  trpcClient.accountOverview.provideFeedback.mutate(),
                                              )
                                        : undefined
                                }
                                loading={headerUpdating}
                                refreshDisabled={headerLoading}
                                defaultEssentialsOpen
                                timeRange={timeRange}
                                onTimeRangeChange={handleTimeRangeChange}
                                containers={containers}
                                selectedContainer={selectedContainer}
                                onSelectContainer={handleScopeChange}
                                databaseIds={inventory.databases}
                                accountActionBusy={accountActionBusy}
                                onAccountAction={(input) => void runAccountAction(input)}
                            />
                            <AccountActions
                                isAIFeaturesEnabled={isAIFeaturesEnabled}
                                isDataModelerEnabled={isDataModelerEnabled}
                                busy={accountActionBusy}
                                supported={inventory.supported}
                                databaseId={selectedContainer?.databaseId}
                                failure={accountActionFailure}
                                onAction={(input) => void runAccountAction(input)}
                            />
                        </>
                    }
                    monitoring={
                        <MetricsSection
                            order={METRIC_ORDER}
                            seriesByMetric={trends}
                            applicabilityByMetric={summary.metricApplicability}
                            loading={trendsLoading}
                            timeRange={timeRange}
                            chartAffordances
                            requestedMetric={
                                requestedTarget === 'overview' || requestedTarget === 'advisories'
                                    ? undefined
                                    : requestedTarget
                            }
                            navigationRevision={navigationRevision}
                            active={selectedTab === 'monitoring'}
                        />
                    }
                    inventory={
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Databases and Containers')}
                                description={l10n.t(
                                    'Throughput mode, partition key, and indexing posture per container.',
                                )}
                            />
                            <InventoryTable
                                navigationRevision={navigationRevision}
                                active={selectedTab === 'databases'}
                                rows={inventory.rows}
                                supported={inventory.supported}
                                available={inventory.available}
                                reason={inventory.reason}
                                metrics={inventoryMetrics?.metrics}
                                storageFallback={inventoryMetrics?.storageFallback}
                                normalizedRuApplicability={normalizedRuApplicability}
                                onRevealInTree={handleRevealInTree}
                                onOpenQueryEditor={handleOpenQueryEditor}
                                selectedContainer={partitionContainer}
                                onSelectContainer={handleSelectPartitionContainer}
                            />
                        </DashboardCard>
                    }
                    partitionHealth={
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Partition Key Distribution Health')}
                                description={
                                    normalizedRuApplicability?.status === 'notApplicable'
                                        ? l10n.t(
                                              'Physical-partition storage distribution, not logical partition-key values. Select a container in the inventory or below.',
                                          )
                                        : l10n.t(
                                              'Physical-partition RU and storage distribution, not logical partition-key values. Select a container in the inventory or below.',
                                          )
                                }
                            />
                            <PartitionHealth
                                active={selectedTab === 'databases'}
                                navigationRevision={navigationRevision}
                                result={partitionHealth}
                                loading={partitionLoading}
                                mode={partitionMode}
                                normalizedRuApplicability={normalizedRuApplicability}
                                onModeChange={setPartitionMode}
                                containers={containers}
                                selected={partitionContainer}
                                onSelectContainer={handleSelectPartitionContainer}
                            />
                        </DashboardCard>
                    }
                    alerts={
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Alerts')}
                                description={
                                    alertMonitorCondition === 'Fired'
                                        ? l10n.t('Active Azure Monitor alerts targeting this account.')
                                        : l10n.t('Resolved Azure Monitor alerts targeting this account.')
                                }
                            />
                            <ActiveAlerts
                                active={selectedTab === 'advisories'}
                                result={alerts}
                                portalUrl={summary.alertsPortalUrl}
                                activeSummary={activeAlerts}
                                activeSummaryLoading={activeAlertsLoading}
                                activeSummaryUnavailable={activeAlertsUnavailable}
                                loading={alertsLoading || refreshing}
                                timeRange={alertTimeRange}
                                monitorCondition={alertMonitorCondition}
                                onTimeRangeChange={handleAlertTimeRangeChange}
                                onMonitorConditionChange={handleAlertMonitorConditionChange}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>
                    }
                    recommendations={
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Azure Advisor recommendations')}
                                description={l10n.t('Azure Advisor guidance for this account.')}
                            />
                            <Recommendations
                                result={recommendations}
                                loading={recommendationsLoading}
                                onOpenUrl={handleOpenUrl}
                            />
                        </DashboardCard>
                    }
                    advisories={
                        <DashboardCard>
                            <SectionHeader
                                title={l10n.t('Derived Advisories')}
                                description={l10n.t(
                                    "Advisories computed from this account's telemetry, not the Azure portal.",
                                )}
                            />
                            <DerivedAdvisories
                                active={selectedTab === 'advisories'}
                                navigationRevision={navigationRevision}
                                result={derivedAdvisories}
                                loading={derivedLoading}
                                dismissedIds={dismissedAdvisoryIds}
                                onDismiss={handleDismissAdvisory}
                            />
                        </DashboardCard>
                    }
                />
            </div>
            {creationBusy && (
                <div
                    className={styles.creationOverlay}
                    aria-hidden
                    // Keep clicks on the backdrop from moving focus away from the native VS Code wizard.
                    onPointerDown={(event) => event.preventDefault()}
                />
            )}
        </DashboardActionsProvider>
    );
};
