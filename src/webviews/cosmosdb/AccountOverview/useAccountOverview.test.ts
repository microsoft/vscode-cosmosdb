/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { createElement } from 'react';
import { vi } from 'vitest';
import { type AccountOverviewAppRouter, type MetricSeriesResult } from '../../api/types';
import { AccountOverview } from './AccountOverview';
import { METRIC_ORDER } from './metrics/descriptors';
import { useAccountOverview } from './useAccountOverview';

type Inputs = inferRouterInputs<AccountOverviewAppRouter>['accountOverview'];
type Outputs = inferRouterOutputs<AccountOverviewAppRouter>['accountOverview'];

const { api } = vi.hoisted(() => {
    const query = <K extends keyof Outputs>() => ({
        query: vi.fn<(input?: Inputs[K]) => Promise<Outputs[K]>>(),
    });
    return {
        api: {
            getAccountSummary: query<'getAccountSummary'>(),
            getInventory: query<'getInventory'>(),
            getInventoryMetrics: query<'getInventoryMetrics'>(),
            getMetricSeries: query<'getMetricSeries'>(),
            getOverviewAnalytics: query<'getOverviewAnalytics'>(),
            runAccountAction: { mutate: vi.fn<(input: Inputs['runAccountAction']) => Promise<void>>() },
            getPartitionHealth: query<'getPartitionHealth'>(),
            getAlerts: query<'getAlerts'>(),
            getRecommendations: query<'getRecommendations'>(),
            getDerivedAdvisories: query<'getDerivedAdvisories'>(),
            reportEvent: { mutate: vi.fn<() => Promise<void>>() },
            openUrl: { mutate: vi.fn<() => Promise<void>>() },
            revealInTree: { mutate: vi.fn<() => Promise<void>>() },
            openQueryEditor: { mutate: vi.fn<() => Promise<void>>() },
        },
    };
});

vi.mock('@microsoft/vscode-ext-webview/react', () => {
    const client = { accountOverview: api };
    return { useTrpcClient: () => client };
});

const summary: Outputs['getAccountSummary'] = {
    accountName: 'test-account',
    resourceGroup: 'test-group',
    subscriptionId: 'test-subscription',
    subscriptionName: 'Test subscription',
    apiType: 'NoSQL',
    documentEndpoint: 'https://example.invalid',
    isServerless: false,
    provisioningState: 'Succeeded',
    consistencyLevel: 'Session',
    freeTierEnabled: false,
    backupPolicyType: 'Periodic',
    automaticFailoverEnabled: true,
    backupRetentionHours: 168,
    backupIntervalMinutes: 240,
    continuousBackupTier: undefined,
    totalThroughputLimit: 4000,
    writeRegions: ['East US'],
    readRegions: ['East US'],
    writeRegionCount: 1,
    readRegionCount: 1,
    lastRefreshedAt: 1000,
};

const container = { databaseId: 'database', containerId: 'container' };
const inventory: Outputs['getInventory'] = {
    supported: true,
    available: true,
    databases: ['database', 'empty-database'],
    rows: [
        {
            ...container,
            throughputMode: 'dedicated',
            throughputRU: 400,
            partitionKeyPaths: ['/id'],
            indexingMode: 'consistent',
            excludedPathCount: 0,
            compositeIndexCount: 0,
            health: 'Healthy',
        },
    ],
};
const inventoryMetrics: Outputs['getInventoryMetrics'] = {
    available: true,
    timeRange: '24H',
    metrics: {},
    accountHealth: 'Healthy',
    generatedAt: 1000,
};
const alerts: Outputs['getAlerts'] = {
    available: true,
    alerts: [],
    criticalCount: 0,
    warningCount: 0,
    timeRange: '1d',
    generatedAt: 1000,
};
const recommendations: Outputs['getRecommendations'] = {
    available: true,
    recommendations: [],
    hasHighImpactPerfCost: false,
    generatedAt: 1000,
};

function series(input: Inputs['getMetricSeries']): MetricSeriesResult {
    return {
        ...input,
        available: true,
        points: [{ timestamp: 1000, value: 42 }],
        peak: 42,
        generatedAt: 1000,
    };
}

async function mountOverview() {
    const hook = renderHook(() => useAccountOverview());
    await act(async () => {
        await Promise.resolve();
    });
    return hook;
}

describe('useAccountOverview', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        api.getAccountSummary.query.mockResolvedValue(summary);
        api.getOverviewAnalytics.query.mockRejectedValue(new Error('Analytics unavailable'));
        api.runAccountAction.mutate.mockResolvedValue();
        api.getInventory.query.mockResolvedValue(inventory);
        api.getInventoryMetrics.query.mockImplementation(async (input) => ({
            ...inventoryMetrics,
            timeRange: input?.timeRange ?? '24H',
        }));
        api.getMetricSeries.query.mockImplementation(async (input) => {
            if (!input) {
                throw new Error('A metric request requires input.');
            }
            return series(input);
        });
        api.getPartitionHealth.query.mockImplementation(async (input) => ({
            ...container,
            ...input,
            timeRange: input?.timeRange ?? '24H',
            available: true,
            mode: input?.mode ?? 'ru',
            tiles: [],
            skewScore: 0,
            topPartitionShare: 0,
            partitionCount: 0,
            topN: 5,
            generatedAt: 1000,
        }));
        api.getAlerts.query.mockResolvedValue(alerts);
        api.getRecommendations.query.mockResolvedValue(recommendations);
        api.getDerivedAdvisories.query.mockResolvedValue({
            available: true,
            advisories: [],
            generatedAt: 1000,
        });
        api.reportEvent.mutate.mockResolvedValue();
        api.openUrl.mutate.mockResolvedValue();
        api.revealInTree.mutate.mockResolvedValue();
        api.openQueryEditor.mutate.mockResolvedValue();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('loads the existing data once and defaults partition scope to the first container', async () => {
        const { result } = await mountOverview();

        expect(result.current.summary).toEqual(summary);
        expect(result.current.inventory).toEqual(inventory);
        expect(result.current.containers).toEqual([container]);
        expect(result.current.partitionContainer).toEqual(container);
        expect(result.current.timeRange).toBe('24H');
        expect(result.current.alertTimeRange).toBe('1d');
        expect(result.current.trendsLoading).toBe(false);
        expect(result.current.partitionLoading).toBe(false);
        expect(result.current.alertsLoading).toBe(false);
        expect(result.current.recommendationsLoading).toBe(false);
        expect(result.current.derivedLoading).toBe(false);
        expect(result.current.autoRefreshIntervalsSeconds).toEqual({ metrics: 60, inventory: 30, alerts: 60 });
        expect(api.getAccountSummary.query).toHaveBeenCalledTimes(1);
        expect(api.getInventory.query).toHaveBeenCalledTimes(1);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length);
        expect(api.getPartitionHealth.query).toHaveBeenCalledExactlyOnceWith({
            ...container,
            mode: 'ru',
            timeRange: '24H',
        });
    });

    it('keeps loading state until the summary and inventory resolve', async () => {
        let finishSummary: ((value: Outputs['getAccountSummary']) => void) | undefined;
        api.getAccountSummary.query.mockReturnValue(
            new Promise((resolve) => {
                finishSummary = resolve;
            }),
        );
        const { result } = await mountOverview();
        expect(result.current.summary).toBeUndefined();
        expect(result.current.inventory).toEqual(inventory);

        await act(async () => {
            finishSummary?.(summary);
        });
        expect(result.current.summary).toEqual(summary);
    });

    it('switches real presentations without remounting the shared lifecycle or losing filters and pause', async () => {
        render(createElement(AccountOverview));
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
        expect(api.getOverviewAnalytics.query).not.toHaveBeenCalled();
        const preview = screen.getByRole('button', { name: 'Preview' });
        preview.focus();
        fireEvent.click(preview);
        expect(preview).toHaveFocus();
        expect(screen.getByRole('main', { name: 'Account overview' })).toBeInTheDocument();
        await act(async () => {
            fireEvent.change(screen.getByRole('combobox', { name: 'Metric time range' }), { target: { value: '7D' } });
            fireEvent.change(screen.getByRole('combobox', { name: 'Metric scope' }), { target: { value: '0' } });
            fireEvent.click(screen.getByText('Refresh options'));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('switch', { name: 'Pause auto-refresh' }));
        });
        const trendCalls = api.getMetricSeries.query.mock.calls.length;
        const analyticsCalls = api.getOverviewAnalytics.query.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Original' }));
        fireEvent.click(preview);
        expect(screen.getByRole('combobox', { name: 'Metric time range' })).toHaveValue('7D');
        expect(screen.getByRole('combobox', { name: 'Metric scope' })).toHaveValue('0');
        fireEvent.click(screen.getByText('Auto-refresh paused'));
        expect(screen.getByRole('switch', { name: 'Pause auto-refresh' })).toBeChecked();
        expect(api.getAccountSummary.query).toHaveBeenCalledTimes(1);
        expect(api.getInventory.query).toHaveBeenCalledTimes(1);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(trendCalls);
        expect(api.getOverviewAnalytics.query).toHaveBeenCalledTimes(analyticsCalls);
    });

    it('exposes account details inline and manages focus for full diagnostics and return', async () => {
        const user = userEvent.setup();
        render(createElement(AccountOverview));
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        const details = screen.getByRole('button', { name: 'Account details' });
        expect(details).toHaveAccessibleName('Account details');
        expect(details).toHaveAttribute('aria-expanded', 'false');
        details.focus();
        await user.keyboard('{Enter}');
        expect(details).toHaveAttribute('aria-expanded', 'true');
        expect(details).toHaveFocus();
        expect(screen.getByRole('region', { name: 'Account details' })).toHaveTextContent('Test subscription');
        await user.click(screen.getByRole('button', { name: 'Metric details' }));
        expect(screen.getByRole('heading', { name: 'Metric details' })).toHaveFocus();
        await user.click(screen.getByRole('button', { name: 'Back to summary' }));
        expect(screen.getByRole('main', { name: 'Account overview' })).toHaveFocus();
        expect(api.getAccountSummary.query).toHaveBeenCalledTimes(1);
    });
    it('keeps account actions scoped, supports empty databases, and preserves in-flight state across versions', async () => {
        render(createElement(AccountOverview));
        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Preview' })));
        expect(screen.getByRole('button', { name: 'Add container' })).toBeDisabled();
        await act(async () =>
            fireEvent.change(screen.getByRole('combobox', { name: 'Metric scope' }), { target: { value: '1' } }),
        );
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add container' })));
        expect(api.runAccountAction.mutate).toHaveBeenCalledWith({
            action: 'createContainer',
            databaseId: 'empty-database',
        });
        expect(api.getInventory.query).toHaveBeenCalledTimes(2);
        let rejectAction: ((reason: Error) => void) | undefined;
        api.runAccountAction.mutate.mockImplementationOnce(
            () =>
                new Promise((_, reject) => {
                    rejectAction = reject;
                }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Account details' }));
        fireEvent.click(screen.getByRole('button', { name: 'View cost' }));
        expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Original' }));
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        fireEvent.click(screen.getByRole('button', { name: 'Account details' }));
        expect(screen.getByRole('button', { name: 'View cost' })).toBeDisabled();
        await act(async () => rejectAction?.(new Error('Host failure')));
        expect(
            screen.getByText('The account action could not be completed. Retry or use the Azure Resources view.'),
        ).toHaveAttribute('role', 'alert');
        expect(screen.getByRole('button', { name: 'View cost' })).toBeEnabled();
        expect(api.runAccountAction.mutate).toHaveBeenCalledTimes(2);
    });

    it('reloads metrics for the selected range and scope without reloading static inventory', async () => {
        const { result } = await mountOverview();

        await act(async () => {
            result.current.setTimeRange('7D');
            result.current.setSelectedContainer({ databaseId: 'other-database' });
        });

        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 2);
        for (const metric of METRIC_ORDER) {
            expect(api.getMetricSeries.query).toHaveBeenCalledWith({
                metric,
                timeRange: '7D',
                databaseId: 'other-database',
                containerId: undefined,
            });
        }
        expect(api.getInventoryMetrics.query).toHaveBeenLastCalledWith({ timeRange: '7D' });
        expect(api.getPartitionHealth.query).toHaveBeenLastCalledWith({
            ...container,
            mode: 'ru',
            timeRange: '7D',
        });
        expect(api.getInventory.query).toHaveBeenCalledTimes(1);
    });

    it('reloads static inventory explicitly after resource changes without resetting the selected window', async () => {
        const { result } = await mountOverview();
        await act(async () => result.current.setTimeRange('7D'));
        api.getInventory.query.mockResolvedValue({
            ...inventory,
            rows: [...inventory.rows, { ...inventory.rows[0], containerId: 'created-container' }],
        });
        await act(async () => result.current.reloadInventory());
        expect(result.current.containers).toContainEqual({
            databaseId: container.databaseId,
            containerId: 'created-container',
        });
        expect(result.current.timeRange).toBe('7D');
        expect(api.getInventory.query).toHaveBeenCalledTimes(2);
    });

    it('changes partition and alert controls independently of the metric scope', async () => {
        const { result } = await mountOverview();
        const selected = { databaseId: 'another-database', containerId: 'another-container' };
        await act(async () => {
            result.current.handleSelectPartitionContainer(selected);
            result.current.setPartitionMode('storage');
            result.current.setAlertTimeRange('7d');
        });

        expect(api.getPartitionHealth.query).toHaveBeenLastCalledWith({
            ...selected,
            mode: 'storage',
            timeRange: '24H',
        });
        expect(api.getAlerts.query).toHaveBeenLastCalledWith({ timeRange: '7d' });
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length);
        expect(result.current.selectedContainer).toBeUndefined();
    });

    it('isolates a rejected metric and preserves unavailable-source reasons', async () => {
        api.getMetricSeries.query.mockRejectedValueOnce(new Error('Transport failure'));
        api.getRecommendations.query.mockResolvedValue({
            ...recommendations,
            available: false,
            reason: 'rbac',
        });
        const { result } = await mountOverview();

        expect(result.current.trends.normalizedRu).toMatchObject({
            available: false,
            reason: 'noData',
            points: [],
            timeRange: '24H',
        });
        expect(result.current.trends.totalRequests?.available).toBe(true);
        expect(result.current.trendsLoading).toBe(false);
        expect(result.current.recommendations).toMatchObject({ available: false, reason: 'rbac' });
    });

    it('resolves an inventory transport failure to the existing unavailable state', async () => {
        api.getInventory.query.mockRejectedValue(new Error('Transport failure'));
        const { result } = await mountOverview();

        expect(result.current.inventory).toEqual({
            supported: true,
            available: false,
            reason: 'noData',
            rows: [],
        });
        expect(result.current.containers).toEqual([]);
        expect(api.getPartitionHealth.query).not.toHaveBeenCalled();
    });

    it('does not let an older trend request replace the latest selected window', async () => {
        const { result } = await mountOverview();
        let finishOlder: ((value: MetricSeriesResult) => void) | undefined;
        const older = new Promise<MetricSeriesResult>((resolve) => {
            finishOlder = resolve;
        });
        api.getMetricSeries.query.mockImplementation(async (input) => {
            if (!input) {
                throw new Error('A metric request requires input.');
            }
            return input.metric === 'normalizedRu' && input.timeRange === '1H' ? older : series(input);
        });

        await act(async () => result.current.setTimeRange('1H'));
        expect(result.current.trendsLoading).toBe(true);
        await act(async () => result.current.setTimeRange('7D'));
        expect(result.current.trends.normalizedRu?.timeRange).toBe('7D');
        expect(result.current.trendsLoading).toBe(false);

        await act(async () => finishOlder?.(series({ metric: 'normalizedRu', timeRange: '1H' })));
        expect(result.current.trends.normalizedRu?.timeRange).toBe('7D');
        expect(result.current.trendsLoading).toBe(false);
    });

    it('clears old inventory values on range changes and ignores stale inventory and partition responses', async () => {
        const { result } = await mountOverview();
        let finishInventory: ((value: Outputs['getInventoryMetrics']) => void) | undefined;
        let finishPartition: ((value: Outputs['getPartitionHealth']) => void) | undefined;
        api.getInventoryMetrics.query.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishInventory = resolve;
                }),
        );
        api.getPartitionHealth.query.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishPartition = resolve;
                }),
        );
        await act(async () => result.current.setTimeRange('1H'));
        expect(result.current.inventoryMetrics).toBeUndefined();
        expect(result.current.partitionHealth).toBeUndefined();
        await act(async () => result.current.setTimeRange('7D'));
        const currentPartition = result.current.partitionHealth;
        expect(result.current.inventoryMetrics?.accountHealth).toBe('Healthy');
        await act(async () => {
            finishInventory?.({ ...inventoryMetrics, accountHealth: 'Critical' });
            finishPartition?.({
                available: false,
                reason: 'rbac',
                ...container,
                mode: 'ru',
                tiles: [],
                topN: 5,
                skewScore: 0,
                topPartitionShare: 0,
                partitionCount: 0,
                generatedAt: 2000,
            });
        });
        expect(result.current.inventoryMetrics?.accountHealth).toBe('Healthy');
        expect(result.current.partitionHealth).toEqual(currentPartition);
        expect(result.current.partitionLoading).toBe(false);
    });

    it.each([
        { base: 'Healthy', critical: 1, warning: 0, advisor: false, expected: 'Critical' },
        { base: 'Healthy', critical: 0, warning: 1, advisor: false, expected: 'Needs Attention' },
        { base: 'Healthy', critical: 0, warning: 0, advisor: true, expected: 'Needs Attention' },
        { base: 'Critical', critical: 0, warning: 0, advisor: false, expected: 'Critical' },
    ] as const)(
        'preserves health escalation: $base -> $expected',
        async ({ base, critical, warning, advisor, expected }) => {
            api.getInventoryMetrics.query.mockResolvedValue({ ...inventoryMetrics, accountHealth: base });
            api.getAlerts.query.mockResolvedValue({ ...alerts, criticalCount: critical, warningCount: warning });
            api.getRecommendations.query.mockResolvedValue({ ...recommendations, hasHighImpactPerfCost: advisor });
            const { result } = await mountOverview();

            expect(result.current.accountHealth).toBe(expected);
        },
    );

    it('preserves the manual refresh scope even while auto-refresh is paused', async () => {
        const { result } = await mountOverview();
        await act(async () => result.current.setPaused(true));
        await act(async () => result.current.refresh());

        expect(api.getAccountSummary.query).toHaveBeenCalledTimes(2);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 2);
        expect(api.getAlerts.query).toHaveBeenCalledTimes(2);
        expect(api.getRecommendations.query).toHaveBeenCalledTimes(2);
        expect(api.getDerivedAdvisories.query).toHaveBeenCalledTimes(2);
        expect(api.getInventory.query).toHaveBeenCalledTimes(1);
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(1);
        expect(api.getPartitionHealth.query).toHaveBeenCalledTimes(1);
        expect(api.reportEvent.mutate).toHaveBeenCalledWith({
            eventName: 'refreshTicked',
            properties: { windowSize: '24H' },
            measurements: undefined,
        });
    });

    it('gates polls on visibility and pause, and cleans up timers and listeners on unmount', async () => {
        vi.useFakeTimers();
        const { result, unmount } = await mountOverview();
        await act(async () => vi.advanceTimersByTimeAsync(15_000));
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(2);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length);

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(2);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length);

        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(3);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 2);

        await act(async () => result.current.setPaused(true));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000);
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(3);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 2);

        await act(async () => result.current.setPaused(false));
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(5);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 3);

        const partitionCalls = api.getPartitionHealth.query.mock.calls.length;
        const alertCalls = api.getAlerts.query.mock.calls.length;
        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120_000);
            document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(api.getInventoryMetrics.query).toHaveBeenCalledTimes(5);
        expect(api.getMetricSeries.query).toHaveBeenCalledTimes(METRIC_ORDER.length * 3);
        expect(api.getPartitionHealth.query).toHaveBeenCalledTimes(partitionCalls);
        expect(api.getAlerts.query).toHaveBeenCalledTimes(alertCalls);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps dismissals in memory and forwards host actions without adding resource names to events', async () => {
        const { result } = await mountOverview();
        await act(async () => {
            result.current.handleDismissAdvisory('advisory-id');
            result.current.handleRevealInTree(container.databaseId, container.containerId);
            result.current.handleOpenQueryEditor(container.databaseId, container.containerId);
            result.current.handleOpenUrl('https://example.invalid/details');
        });

        expect(result.current.dismissedAdvisoryIds.has('advisory-id')).toBe(true);
        expect(api.revealInTree.mutate).toHaveBeenCalledWith(container);
        expect(api.openQueryEditor.mutate).toHaveBeenCalledWith(container);
        expect(api.openUrl.mutate).toHaveBeenCalledWith({ url: 'https://example.invalid/details' });
        expect(api.reportEvent.mutate.mock.calls).toEqual([
            [{ eventName: 'deepLinkFollowed', properties: { target: 'tree' }, measurements: undefined }],
            [{ eventName: 'deepLinkFollowed', properties: { target: 'dataExplorer' }, measurements: undefined }],
        ]);
    });
});
