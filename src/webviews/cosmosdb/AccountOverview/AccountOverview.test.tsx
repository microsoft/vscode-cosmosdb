/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type AccountOverviewNavigation,
    type AccountOverviewTarget,
    type InventoryContainerRow,
    type MetricKey,
    type PartitionHealthResult,
    type TimeRange,
} from '../../api/types';
import { type AccountSummary } from './AccountHeader';
import { AccountOverview } from './AccountOverview';
import { METRIC_ORDER, METRIC_VIEWS } from './metrics/descriptors';

const queries = vi.hoisted(() => ({
    summary: vi.fn(),
    inventory: vi.fn(),
    inventoryMetrics: vi.fn(),
    metric: vi.fn(),
    partition: vi.fn(),
    alerts: vi.fn(),
    recommendations: vi.fn(),
    advisories: vi.fn(),
    navigation: vi.fn(),
    unsubscribe: vi.fn(),
    reportEvent: vi.fn(),
    reveal: vi.fn(),
    queryEditor: vi.fn(),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => {
    const client = {
        accountOverview: {
            getAccountSummary: { query: queries.summary },
            getInventory: { query: queries.inventory },
            getInventoryMetrics: { query: queries.inventoryMetrics },
            getMetricSeries: { query: queries.metric },
            getPartitionHealth: { query: queries.partition },
            getAlerts: { query: queries.alerts },
            getRecommendations: { query: queries.recommendations },
            getDerivedAdvisories: { query: queries.advisories },
            navigation: { subscribe: queries.navigation },
            reportEvent: { mutate: queries.reportEvent },
            revealInTree: { mutate: queries.reveal },
            openQueryEditor: { mutate: queries.queryEditor },
        },
    };
    return { useTrpcClient: () => client };
});
vi.mock('./metrics/MetricChart', () => ({ MetricChart: () => null }));
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({ index, start: index * 48, end: (index + 1) * 48 })),
        getTotalSize: () => count * 48,
        measureElement: () => {},
    }),
}));

const summary: AccountSummary = {
    accountName: 'test-account',
    resourceGroup: 'test-group',
    subscriptionId: 'test-subscription',
    subscriptionName: 'Test subscription',
    apiType: 'NoSQL',
    documentEndpoint: 'https://example.invalid',
    isServerless: false,
    provisioningState: 'Succeeded',
    freeTierEnabled: false,
    writeRegions: ['East US'],
    readRegions: ['East US'],
    writeRegionCount: 1,
    readRegionCount: 1,
    lastRefreshedAt: 1000,
};
const rows: InventoryContainerRow[] = ['orders', 'products'].map((containerId) => ({
    databaseId: 'database',
    containerId,
    throughputMode: 'dedicated',
    throughputRU: 400,
    partitionKeyPaths: ['/id'],
    indexingMode: 'consistent',
    excludedPathCount: 0,
    compositeIndexCount: 0,
    health: 'Healthy',
}));

type NavigationCallbacks = {
    onData: (navigation: AccountOverviewNavigation) => void;
    onError: () => void;
};
let callbacks: NavigationCallbacks;
let initialTarget: AccountOverviewTarget;

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

function navigate(target: AccountOverviewTarget, revision: number) {
    act(() => callbacks.onData({ type: 'navigate', target, revision }));
}

beforeEach(() => {
    vi.resetAllMocks();
    initialTarget = 'overview';
    queries.navigation.mockImplementation((_input: unknown, next: NavigationCallbacks) => {
        callbacks = next;
        next.onData({ type: 'navigate', target: initialTarget, revision: 0 });
        return { unsubscribe: queries.unsubscribe };
    });
    queries.summary.mockResolvedValue(summary);
    queries.inventory.mockResolvedValue({ supported: true, available: true, rows });
    queries.inventoryMetrics.mockResolvedValue({ available: false, reason: 'noData', metrics: {} });
    queries.metric.mockImplementation(({ metric, timeRange }: { metric: MetricKey; timeRange: TimeRange }) =>
        Promise.resolve({ metric, timeRange, available: false, reason: 'noData', points: [], generatedAt: 0 }),
    );
    queries.partition.mockResolvedValue({ available: false, reason: 'noData', tiles: [] });
    queries.alerts.mockResolvedValue({
        available: true,
        alerts: [],
        criticalCount: 0,
        warningCount: 0,
        timeRange: '1d',
        generatedAt: 0,
    });
    queries.recommendations.mockResolvedValue({
        available: true,
        recommendations: [],
        hasHighImpactPerfCost: false,
        generatedAt: 0,
    });
    queries.advisories.mockResolvedValue({ available: true, advisories: [], generatedAt: 0 });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        if (this.hidden || getComputedStyle(this).display === 'none') {
            return null;
        }
        for (let element = this.parentElement; element; element = element.parentElement) {
            if (element.hidden || getComputedStyle(element).display === 'none') {
                return null;
            }
        }
        return this.parentElement;
    });
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':modal' ? false : matches.call(this, selector);
    });
});

afterEach(() => vi.restoreAllMocks());

describe('tabbed Account Overview', () => {
    it('defaults to Monitoring with three peer tabs and expanded Essentials', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        const monitoring = await screen.findByRole('tab', { name: 'Monitoring' });
        expect(monitoring).toHaveAttribute('aria-selected', 'true');
        expect(screen.getAllByRole('tablist')).toHaveLength(1);
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        for (const [index, label] of ['Monitoring', 'Databases and Containers', 'Advisories'].entries()) {
            expect(tabs[index]).toHaveTextContent(label);
            expect(tabs[index]).toHaveAccessibleName(label);
        }
        expect(screen.getByRole('region', { name: 'Essentials' })).toBeVisible();
        expect(screen.getByRole('tabpanel', { name: 'Monitoring' })).toHaveAttribute(
            'id',
            monitoring.getAttribute('aria-controls'),
        );
        expect(screen.getByRole('heading', { name: 'Normalized RU trend' })).toBeVisible();
        expect(screen.queryByRole('heading', { name: 'Derived Advisories' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        expect(screen.getByRole('heading', { name: 'Derived Advisories' })).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Azure Advisor recommendations' })).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Active Alerts' })).toBeVisible();
        expect(screen.queryByRole('heading', { name: 'Normalized RU trend' })).not.toBeInTheDocument();
    });

    it('supports keyboard navigation across all three tabs', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        (await screen.findByRole('tab', { name: 'Monitoring' })).focus();
        await user.keyboard('{ArrowRight}{Enter}');
        expect(screen.getByRole('tab', { name: 'Databases and Containers' })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{ArrowRight}{Enter}');
        expect(screen.getByRole('tab', { name: 'Advisories' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Advisories' })).toHaveFocus();
    });

    it('selects charts from both keyboard-accessible tiles and eye buttons', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        const tile = screen.getByRole('button', { name: /^Document count/ });
        expect(tile).toHaveTextContent('Document count');
        expect(tile).toHaveAccessibleName(/Document count/);
        tile.focus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('heading', { name: 'Document count trend' })).toBeVisible();
        expect(tile).toHaveAttribute('aria-pressed', 'true');
        const eye = screen.getByRole('button', { name: 'Show chart: Server-side latency' });
        eye.focus();
        await user.keyboard(' ');
        expect(screen.getByRole('heading', { name: 'Server-side latency trend' })).toBeVisible();
        expect(eye).toHaveAttribute('aria-pressed', 'true');
    });

    it.each(METRIC_ORDER)(
        'opens the %s card from the submenu without changing filters or adding queries',
        async (metric) => {
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            await user.click(screen.getByRole('button', { name: 'Show the last 7 days (7D)' }));
            await user.click(screen.getByRole('combobox', { name: 'Database scope for metrics' }));
            await user.click(screen.getByRole('option', { name: 'database' }));
            await user.click(screen.getByRole('tab', { name: 'Advisories' }));
            const calls = queries.metric.mock.calls.length;

            navigate(metric, 1);

            expect(screen.getByRole('tab', { name: 'Monitoring' })).toHaveAttribute('aria-selected', 'true');
            const label = METRIC_VIEWS[metric].label;
            const chart = screen.getByRole('region', { name: `${label} trend` });
            expect(chart).toBeVisible();
            expect(chart).toHaveFocus();
            expect(screen.getByRole('button', { name: `Show chart: ${label}` })).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            expect(screen.getByRole('button', { name: 'Show the last 7 days (7D)' })).toHaveAttribute(
                'aria-pressed',
                'true',
            );
            expect(screen.getByRole('combobox', { name: 'Database scope for metrics' })).toHaveTextContent('database');
            expect(queries.metric).toHaveBeenCalledTimes(calls);
            expect(queries.navigation).toHaveBeenCalledTimes(1);
        },
    );

    it('reselects a repeated submenu target and ignores older navigation events', async () => {
        const user = userEvent.setup();
        initialTarget = 'documentCount';
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByRole('heading', { name: 'Document count trend' })).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Show chart: Normalized RU' }));
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        navigate('documentCount', 2);
        expect(screen.getByRole('region', { name: 'Document count trend' })).toHaveFocus();
        navigate('advisories', 1);
        expect(screen.getByRole('tab', { name: 'Monitoring' })).toHaveAttribute('aria-selected', 'true');
        navigate('advisories', 3);
        expect(screen.getByRole('tab', { name: 'Advisories' })).toHaveAttribute('aria-selected', 'true');
        navigate('overview', 4);
        expect(screen.getByRole('heading', { name: 'Document count trend' })).toBeVisible();
    });

    it('honors a menu destination received before initial data resolves', async () => {
        const pending = Promise.withResolvers<AccountSummary>();
        queries.summary.mockReturnValue(pending.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        navigate('serverLatency', 1);
        await act(async () => pending.resolve(summary));
        expect(await screen.findByRole('region', { name: 'Server-side latency trend' })).toHaveFocus();
    });

    it('preserves inventory search and coordinates selection without intercepting independent actions', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const select = screen.getByRole('button', { name: 'products: show partition health in database' });
        expect(select).toHaveTextContent('products');
        expect(select).toHaveAccessibleName('products: show partition health in database');
        await user.click(select);
        expect(select).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('combobox', { name: 'Select a container for partition health' })).toHaveTextContent(
            'products',
        );
        expect(queries.partition).toHaveBeenLastCalledWith(
            expect.objectContaining({ databaseId: 'database', containerId: 'products' }),
        );
        const row = select.closest('tr');
        expect(row).not.toBeNull();
        if (!row) {
            throw new Error('Missing inventory row');
        }
        await user.click(within(row).getByRole('button', { name: 'Reveal in tree' }));
        await user.click(within(row).getByRole('button', { name: 'Open Query Editor' }));
        expect(queries.reveal).toHaveBeenCalledWith({ databaseId: 'database', containerId: 'products' });
        expect(queries.queryEditor).toHaveBeenCalledWith({ databaseId: 'database', containerId: 'products' });
        fireEvent.change(screen.getByRole('textbox', { name: 'Search containers or databases' }), {
            target: { value: 'products' },
        });
        navigate('totalRequests', 1);
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        expect(screen.getByRole('textbox', { name: 'Search containers or databases' })).toHaveValue('products');
        expect(
            screen.queryByRole('button', { name: 'orders: show partition health in database' }),
        ).not.toBeInTheDocument();
    });

    it('does not replace current partition health with a slower previous selection', async () => {
        const user = userEvent.setup();
        const old = Promise.withResolvers<PartitionHealthResult>();
        const current = Promise.withResolvers<PartitionHealthResult>();
        queries.partition.mockImplementation(({ containerId }: { containerId: string }) =>
            containerId === 'orders' ? old.promise : current.promise,
        );
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        await user.click(screen.getByRole('button', { name: 'products: show partition health in database' }));
        const result: PartitionHealthResult = {
            available: true,
            mode: 'ru',
            databaseId: 'database',
            containerId: 'products',
            tiles: [{ partitionId: 'current', sharePercent: 20, level: 1, hot: false }],
            skewScore: 0,
            topPartitionShare: 20,
            partitionCount: 1,
            topN: 5,
            generatedAt: 0,
        };
        await act(async () => current.resolve(result));
        await act(async () =>
            old.resolve({ ...result, containerId: 'orders', tiles: [{ ...result.tiles[0], partitionId: 'old' }] }),
        );
        expect(screen.getAllByText('PKR-current').length).toBeGreaterThan(0);
        expect(screen.queryByText('PKR-old')).not.toBeInTheDocument();
    });

    it('distinguishes identically named containers in different databases', async () => {
        const user = userEvent.setup();
        queries.inventory.mockResolvedValue({
            supported: true,
            available: true,
            rows: [rows[0], { ...rows[0], databaseId: 'other-database' }],
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const other = screen.getByRole('button', { name: 'orders: show partition health in other-database' });
        other.focus();
        await user.keyboard('{Enter}');
        expect(other).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'orders: show partition health in database' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        expect(queries.partition).toHaveBeenLastCalledWith(
            expect.objectContaining({ databaseId: 'other-database', containerId: 'orders' }),
        );
    });

    it('surfaces navigation failures and retries without resetting loaded dashboard state', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.click(screen.getByRole('button', { name: 'Show the last 7 days (7D)' }));
        act(() => callbacks.onError());
        expect(screen.getByRole('alert')).toHaveTextContent('Account Overview navigation could not be loaded.');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(queries.unsubscribe).toHaveBeenCalledTimes(1);
        expect(queries.navigation).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('button', { name: 'Show the last 7 days (7D)' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });
});
