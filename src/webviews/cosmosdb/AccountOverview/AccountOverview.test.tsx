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
    type AccountActionResult,
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
    accountAction: vi.fn(),
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
            runAccountAction: { mutate: queries.accountAction },
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

function dataQueryCounts() {
    const keys = [
        'summary',
        'inventory',
        'inventoryMetrics',
        'metric',
        'partition',
        'alerts',
        'recommendations',
        'advisories',
    ] as const;
    return Object.fromEntries(keys.map((key) => [key, queries[key].mock.calls.length]));
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
    queries.accountAction.mockResolvedValue({ status: 'completed' } satisfies AccountActionResult);
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

describe('Account Overview account actions', () => {
    it('never dispatches or refreshes from the keyboard-accessible Data Modeler placeholder', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
        const counts = dataQueryCounts();
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(modeler).toHaveTextContent('Try Data Modeler');
        expect(modeler).toHaveAccessibleName('Try Data Modeler');
        expect(modeler).toHaveAttribute('aria-disabled', 'true');
        screen.getByRole('button', { name: 'Delete account' }).focus();
        await user.tab();
        expect(modeler).toHaveFocus();
        await waitFor(() => expect(modeler).toHaveAccessibleDescription('Data Modeler is not implemented yet.'));
        await user.keyboard('{Enter} ');
        await user.click(modeler);
        expect(queries.accountAction).not.toHaveBeenCalled();
        expect(dataQueryCounts()).toEqual(counts);
    });

    it.each([
        ['View cost', 'openCosts'],
        ['JSON view', 'openJson'],
    ] as const)('routes %s without refreshing data or resetting metric filters', async (label, action) => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.selectOptions(screen.getByRole('combobox', { name: /^Metric time range:/ }), '7D');
        await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '0');
        const counts = dataQueryCounts();
        const button = screen.getByRole('button', { name: label });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        await user.click(button);
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action });
        await waitFor(() => expect(button).toBeEnabled());
        expect(dataQueryCounts()).toEqual(counts);
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveDisplayValue('Last 7 days');
        expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveDisplayValue('database');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('blocks duplicate and cross-toolbar actions while a mutation is pending, then unlocks on cancellation', async () => {
        const user = userEvent.setup();
        const pending = Promise.withResolvers<AccountActionResult>();
        queries.accountAction.mockReturnValueOnce(pending.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '0');
        const counts = dataQueryCounts();
        const addDatabase = screen.getByRole('button', { name: 'Add database' });
        const json = screen.getByRole('button', { name: 'JSON view' });
        act(() => {
            fireEvent.click(addDatabase);
            fireEvent.click(addDatabase);
            fireEvent.click(json);
        });
        const actions = within(screen.getByRole('region', { name: 'Account actions' }));
        expect(actions.getByRole('status')).toHaveTextContent('Account action in progress…');
        for (const label of ['Add database', 'Delete account', 'View cost', 'JSON view']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        const addContainer = screen.getByRole('button', { name: 'Add container' });
        expect(addContainer).toHaveAttribute('aria-disabled', 'true');
        addContainer.focus();
        await user.keyboard('{Enter} ');
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'createDatabase' });
        await act(async () => pending.resolve({ status: 'cancelled' }));
        expect(actions.getByRole('status')).toBeEmptyDOMElement();
        expect(addDatabase).toBeEnabled();
        expect(json).toBeEnabled();
        expect(addContainer).not.toHaveAttribute('aria-disabled', 'true');
        expect(dataQueryCounts()).toEqual(counts);
        await user.click(json);
        expect(queries.accountAction).toHaveBeenCalledTimes(2);
        expect(queries.accountAction).toHaveBeenLastCalledWith({ action: 'openJson' });
    });

    it.each([
        ['Add database', 'createDatabase'],
        ['Add container', 'createContainer'],
        ['Delete account', 'deleteAccount'],
        ['View cost', 'openCosts'],
        ['JSON view', 'openJson'],
    ] as const)('keeps the dashboard and data unchanged when %s is cancelled', async (label, action) => {
        const user = userEvent.setup();
        queries.accountAction.mockResolvedValue({ status: 'cancelled' } satisfies AccountActionResult);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '0');
        const counts = dataQueryCounts();
        const dashboard = screen.getByRole('tablist');
        await user.click(screen.getByRole('button', { name: label }));
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith(
            action === 'createContainer' ? { action, databaseId: 'database' } : { action },
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled());
        expect(screen.getByRole('tablist')).toBe(dashboard);
        expect(dataQueryCounts()).toEqual(counts);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText('This Cosmos DB account has been deleted.')).not.toBeInTheDocument();
    });

    it.each(['Add database', 'Add container', 'Delete account', 'View cost', 'JSON view'])(
        'announces a rejected %s mutation without refreshing or unmounting, and allows retry',
        async (label) => {
            const user = userEvent.setup();
            queries.accountAction.mockRejectedValueOnce(new Error('mutation failed'));
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '0');
            const dashboard = screen.getByRole('tablist');
            const counts = dataQueryCounts();
            await user.click(screen.getByRole('button', { name: label }));
            expect(await screen.findByRole('alert')).toHaveTextContent(
                'The account action could not be completed. Retry or use the Azure Resources view.',
            );
            expect(screen.getByRole('alert')).toBeVisible();
            expect(screen.getByRole('tablist')).toBe(dashboard);
            expect(dataQueryCounts()).toEqual(counts);
            expect(screen.queryByText('This Cosmos DB account has been deleted.')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
            queries.accountAction.mockResolvedValueOnce({ status: 'cancelled' } satisfies AccountActionResult);
            await user.click(screen.getByRole('button', { name: label }));
            expect(queries.accountAction).toHaveBeenCalledTimes(2);
            expect(queries.accountAction.mock.calls[1]).toEqual(queries.accountAction.mock.calls[0]);
            await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
            expect(dataQueryCounts()).toEqual(counts);
        },
    );

    it('refreshes inventory after creation so a new empty database can be selected to create its first container', async () => {
        const user = userEvent.setup();
        const emptyInventory = { supported: true, available: true, rows: [], databases: [] };
        queries.inventory.mockResolvedValueOnce(emptyInventory);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        const scope = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
        expect(within(scope).getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Add container' })).toHaveAttribute('aria-disabled', 'true');
        queries.inventory.mockResolvedValueOnce({ ...emptyInventory, databases: ['new-empty-db'] });
        await user.click(screen.getByRole('button', { name: 'Add database' }));
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'createDatabase' });
        expect(queries.inventory).toHaveBeenCalledTimes(2);
        const newDatabase = await within(scope).findByRole('option', { name: 'new-empty-db' });
        expect(screen.getByRole('button', { name: 'Add container' })).toHaveAttribute('aria-disabled', 'true');
        await user.selectOptions(scope, newDatabase);
        expect(scope).toHaveDisplayValue('new-empty-db');
        expect(scope).toHaveAccessibleName('Database scope for metrics: new-empty-db');
        expect(queries.metric).toHaveBeenLastCalledWith(
            expect.objectContaining({ databaseId: 'new-empty-db', containerId: undefined }),
        );
        queries.inventory.mockResolvedValueOnce({
            ...emptyInventory,
            databases: ['new-empty-db'],
            rows: [{ ...rows[0], databaseId: 'new-empty-db', containerId: 'first-container' }],
        });
        await user.click(screen.getByRole('button', { name: 'Add container' }));
        expect(queries.accountAction).toHaveBeenLastCalledWith({
            action: 'createContainer',
            databaseId: 'new-empty-db',
        });
        expect(queries.inventory).toHaveBeenCalledTimes(3);
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        expect(
            await screen.findByRole('button', { name: 'first-container: show partition health in new-empty-db' }),
        ).toBeVisible();
        expect(scope).toHaveDisplayValue('new-empty-db');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps the action lock until the post-create inventory refresh finishes', async () => {
        const user = userEvent.setup();
        const pending = Promise.withResolvers<{
            supported: boolean;
            available: boolean;
            rows: InventoryContainerRow[];
        }>();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        queries.inventory.mockReturnValueOnce(pending.promise);
        await user.click(screen.getByRole('button', { name: 'Add database' }));
        expect(queries.inventory).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('button', { name: 'Add database' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'View cost' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Delete account' }));
        expect(queries.accountAction).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve({ supported: true, available: true, rows }));
        expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'View cost' })).toBeEnabled();
    });

    it.each(['rejection', 'unavailable'] as const)(
        'distinguishes a post-create inventory %s from an action failure and retries with manual Refresh',
        async (failure) => {
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            if (failure === 'rejection') {
                queries.inventory.mockRejectedValueOnce(new Error('inventory failed'));
            } else {
                queries.inventory.mockResolvedValueOnce({
                    supported: true,
                    available: false,
                    reason: 'noData',
                    rows: [],
                });
            }
            await user.click(screen.getByRole('button', { name: 'Add database' }));
            expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'createDatabase' });
            expect(await screen.findByRole('alert')).toHaveTextContent(
                'Account data could not be refreshed. Try Refresh again.',
            );
            expect(screen.getByRole('alert')).toBeVisible();
            expect(screen.getByRole('alert')).not.toHaveTextContent('The account action could not be completed.');
            expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
            const counts = dataQueryCounts();
            queries.summary.mockResolvedValue({ ...summary, accountName: 'refreshed-account' });
            queries.inventory.mockResolvedValue({
                supported: true,
                available: true,
                databases: ['database', 'new-empty-db'],
                rows: [...rows, { ...rows[0], containerId: 'new-container' }],
            });
            await user.click(screen.getByRole('button', { name: 'Refresh' }));
            await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
            expect(queries.accountAction).toHaveBeenCalledTimes(1);
            expect(queries.inventory).toHaveBeenCalledTimes(counts.inventory + 1);
            expect(queries.summary).toHaveBeenCalledTimes(counts.summary + 1);
            expect(queries.metric).toHaveBeenCalledTimes(counts.metric + METRIC_ORDER.length);
            expect(queries.alerts).toHaveBeenCalledTimes(counts.alerts + 1);
            expect(queries.recommendations).toHaveBeenCalledTimes(counts.recommendations + 1);
            expect(queries.advisories).toHaveBeenCalledTimes(counts.advisories + 1);
            expect(screen.getByRole('heading', { name: 'refreshed-account' })).toBeVisible();
            const scope = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
            expect(within(scope).getByRole('option', { name: 'new-empty-db' })).toBeInTheDocument();
            await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
            expect(
                screen.getByRole('button', { name: 'new-container: show partition health in database' }),
            ).toBeVisible();
        },
    );

    it('preserves tab, search, partition selection, metric filters, details and pause state across scoped creation', async () => {
        const user = userEvent.setup();
        queries.inventory.mockResolvedValue({
            supported: true,
            available: true,
            databases: ['database', 'other-empty-db'],
            rows,
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.click(screen.getByRole('button', { name: 'Show chart: Document count' }));
        await user.selectOptions(screen.getByRole('combobox', { name: /^Metric time range:/ }), '7D');
        await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '1');
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        await user.click(
            within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '30d' }),
        );
        await user.click(screen.getByRole('button', { name: 'Refresh options' }));
        await user.click(screen.getByRole('switch', { name: 'Pause auto-refresh' }));
        await user.keyboard('{Escape}');
        await user.click(screen.getByRole('button', { name: 'Account details' }));
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        await user.click(screen.getByRole('button', { name: 'products: show partition health in database' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Search containers or databases' }), {
            target: { value: 'products' },
        });
        const counts = dataQueryCounts();
        queries.inventory.mockResolvedValue({
            supported: true,
            available: true,
            databases: ['database', 'other-empty-db'],
            rows: [...rows, { ...rows[0], databaseId: 'other-empty-db', containerId: 'products-new' }],
        });
        await user.click(screen.getByRole('button', { name: 'Add container' }));
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({
            action: 'createContainer',
            databaseId: 'other-empty-db',
        });
        expect(
            await screen.findByRole('button', { name: 'products-new: show partition health in other-empty-db' }),
        ).toBeVisible();
        expect(screen.getByRole('tab', { name: 'Databases and Containers' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('textbox', { name: 'Search containers or databases' })).toHaveValue('products');
        expect(
            screen.queryByRole('button', { name: 'orders: show partition health in database' }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'products: show partition health in database' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.getByRole('combobox', { name: 'Select a container for partition health' })).toHaveTextContent(
            'products',
        );
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveDisplayValue('Last 7 days');
        expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveDisplayValue(
            'other-empty-db',
        );
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('button', { name: 'Auto-refresh paused' })).toBeVisible();
        expect(queries.partition).toHaveBeenCalledTimes(counts.partition);
        expect(queries.metric).toHaveBeenCalledTimes(counts.metric);
        expect(queries.inventory).toHaveBeenCalledTimes(counts.inventory + 1);
        await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
        expect(screen.getByRole('heading', { name: 'Document count trend' })).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(queries.metric).toHaveBeenLastCalledWith(
            expect.objectContaining({ timeRange: '7D', databaseId: 'other-empty-db', containerId: undefined }),
        );
        expect(queries.alerts).toHaveBeenLastCalledWith({ timeRange: '30d' });
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        expect(
            within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '30d' }),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Auto-refresh paused' })).toBeVisible();
    });

    it.each([0, 15_000])(
        'unmounts the dashboard and cleans polling/listeners after deletion at %s ms',
        async (elapsed) => {
            vi.useFakeTimers();
            const addListener = vi.spyOn(document, 'addEventListener');
            const removeListener = vi.spyOn(document, 'removeEventListener');
            const intervals = vi.spyOn(globalThis, 'setInterval');
            const clearIntervals = vi.spyOn(globalThis, 'clearInterval');
            const timeouts = vi.spyOn(globalThis, 'setTimeout');
            const clearTimeouts = vi.spyOn(globalThis, 'clearTimeout');
            const view = render(<AccountOverview />, { wrapper: Wrapper });
            try {
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(elapsed);
                });
                expect(screen.getByRole('tab', { name: 'Monitoring' })).toBeVisible();
                const listeners = addListener.mock.calls.filter(([type]) => type === 'visibilitychange');
                expect(listeners).toHaveLength(4);
                const pollIds = intervals.mock.calls.flatMap(([, delay], index) =>
                    delay === 60_000 || delay === 30_000 ? [intervals.mock.results[index].value] : [],
                );
                expect(pollIds).toHaveLength(elapsed ? 4 : 3);
                const staggerIndex = timeouts.mock.calls.findIndex(([, delay]) => delay === 15_000);
                expect(staggerIndex).toBeGreaterThanOrEqual(0);
                const staggerId = timeouts.mock.results[staggerIndex].value;
                const counts = dataQueryCounts();
                await act(async () => {
                    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
                });
                expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'deleteAccount' });
                const deleted = screen.getByText('This Cosmos DB account has been deleted.');
                expect(deleted).toBeVisible();
                expect(deleted).toHaveRole('status');
                expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
                expect(screen.queryByRole('region', { name: 'Account actions' })).not.toBeInTheDocument();
                expect(screen.queryByRole('heading', { name: summary.accountName })).not.toBeInTheDocument();
                for (const [, listener] of listeners) {
                    expect(removeListener).toHaveBeenCalledWith('visibilitychange', listener);
                }
                for (const id of pollIds) {
                    expect(clearIntervals).toHaveBeenCalledWith(id);
                }
                expect(clearTimeouts).toHaveBeenCalledWith(staggerId);
                await act(async () => {
                    fireEvent(document, new Event('visibilitychange'));
                    await vi.advanceTimersByTimeAsync(120_000);
                });
                navigate('advisories', 1);
                expect(dataQueryCounts()).toEqual(counts);
                expect(deleted).toBeVisible();
                expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
                view.unmount();
                expect(queries.unsubscribe).toHaveBeenCalledTimes(1);
            } finally {
                view.unmount();
                // Restore spies before uninstalling fake timers so afterEach cannot reinstall the fake functions.
                vi.restoreAllMocks();
                vi.useRealTimers();
            }
        },
    );
});

describe('tabbed Account Overview', () => {
    it('defaults to Monitoring with three peer tabs and expanded Account details', async () => {
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
        expect(screen.getByRole('region', { name: 'Account details' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveAttribute('aria-expanded', 'true');
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
            await user.selectOptions(screen.getByRole('combobox', { name: /^Metric time range:/ }), '7D');
            await user.selectOptions(screen.getByRole('combobox', { name: /^Database scope for metrics:/ }), '0');
            expect(queries.metric).toHaveBeenLastCalledWith(
                expect.objectContaining({ timeRange: '7D', databaseId: 'database', containerId: undefined }),
            );
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
            expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveValue('7D');
            expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveDisplayValue('Last 7 days');
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveValue('0');
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveDisplayValue(
                'database',
            );
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
        await user.selectOptions(screen.getByRole('combobox', { name: /^Metric time range:/ }), '7D');
        act(() => callbacks.onError());
        expect(screen.getByRole('alert')).toHaveTextContent('Account Overview navigation could not be loaded.');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(queries.unsubscribe).toHaveBeenCalledTimes(1);
        expect(queries.navigation).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveValue('7D');
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveDisplayValue('Last 7 days');
    });
});
