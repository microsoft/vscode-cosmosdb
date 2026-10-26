/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import type * as FluentUI from '@fluentui/react-components';
import {
    badgeClassNames,
    cardClassNames,
    FluentProvider,
    tabClassNames,
    toggleButtonClassNames,
    toolbarClassNames,
    webLightTheme,
} from '@fluentui/react-components';
import { createEventChannel } from '@microsoft/vscode-ext-webview/webview';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountMetricApplicability } from '../../../panels/accountOverview/metrics/contracts';
import {
    type AccountActionResult,
    type AccountHealthResult,
    type AccountOverviewNavigation,
    type AccountOverviewTarget,
    type ActiveAlertSummary,
    type AlertMonitorCondition,
    type AlertsResult,
    type AlertTimeRange,
    type ContainerMetrics,
    type InventoryContainerRow,
    type MetricKey,
    type PartitionHealthResult,
    type RecommendationsResult,
    type TimeRange,
} from '../../api/types';
import { type AccountSummary } from './AccountHeader';
import { AccountOverview, OverviewDashboard } from './AccountOverview';
import { InventoryTable } from './InventoryTable';
import { METRIC_ORDER, METRIC_VIEWS } from './metrics/descriptors';

const queries = vi.hoisted(() => ({
    summary: vi.fn(),
    inventory: vi.fn(),
    inventoryMetrics: vi.fn(),
    accountHealth: vi.fn(),
    metric: vi.fn(),
    partition: vi.fn(),
    alerts: vi.fn(),
    activeAlerts: vi.fn(),
    recommendations: vi.fn(),
    advisories: vi.fn(),
    navigation: vi.fn(),
    aiFeaturesEnabled: vi.fn(),
    unsubscribeAI: vi.fn(),
    unsubscribe: vi.fn(),
    reportEvent: vi.fn(),
    reveal: vi.fn(),
    queryEditor: vi.fn(),
    accountAction: vi.fn(),
    announce: vi.fn(),
    openUrl: vi.fn(),
    showOutput: vi.fn(),
    showErrorMessage: vi.fn(),
}));
const rpcEvents = createEventChannel();
vi.mock('@fluentui/react-components', async (importOriginal) => ({
    ...(await importOriginal<typeof FluentUI>()),
    useAnnounce: () => ({ announce: queries.announce }),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => {
    const client = {
        accountOverview: {
            showErrorMessage: { mutate: queries.showErrorMessage },
            getAccountSummary: { query: queries.summary },
            getInventory: { query: queries.inventory },
            getInventoryMetrics: { query: queries.inventoryMetrics },
            getAccountHealth: { query: queries.accountHealth },
            getMetricSeries: { query: queries.metric },
            getPartitionHealth: { query: queries.partition },
            getAlerts: { query: queries.alerts },
            getActiveAlertSummary: { query: queries.activeAlerts },
            getRecommendations: { query: queries.recommendations },
            getDerivedAdvisories: { query: queries.advisories },
            navigation: { subscribe: queries.navigation },
            aiFeaturesEnabled: { subscribe: queries.aiFeaturesEnabled },
            reportEvent: { mutate: queries.reportEvent },
            revealInTree: { mutate: queries.reveal },
            openQueryEditor: { mutate: queries.queryEditor },
            runAccountAction: { mutate: queries.accountAction },
            openUrl: { mutate: queries.openUrl },
            showOutput: { mutate: queries.showOutput },
        },
    };
    return { useTrpcClient: () => client, useRpcEvents: () => rpcEvents };
});
vi.mock('./metrics/MetricChart', () => ({ MetricChart: () => null }));

const summary: AccountSummary = {
    accountName: 'test-account',
    alertsPortalUrl:
        'https://portal.azure.us/#@tenant/blade/Microsoft_Azure_Monitoring_Alerts/AlertsSummaryBlade/resourceId/account',
    resourceGroup: 'test-group',
    subscriptionId: 'test-subscription',
    subscriptionName: 'Test subscription',
    apiType: 'NoSQL',
    documentEndpoint: 'https://example.invalid',
    isServerless: false,
    metricApplicability: getAccountMetricApplicability(false),
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
    userExcludedPathCount: 0,
    compositeIndexCount: 0,
    health: 'Healthy',
}));

type NavigationCallbacks = {
    onData: (navigation: AccountOverviewNavigation) => void;
    onError: () => void;
};
let callbacks: NavigationCallbacks;
let initialTarget: AccountOverviewTarget;
let aiCallbacks: { onData: (enabled: boolean) => void; onError: (error: Error) => void };

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

function navigate(target: AccountOverviewTarget, revision: number) {
    act(() => callbacks.onData({ type: 'navigate', target, revision }));
}

async function chooseHeaderOption(user: ReturnType<typeof userEvent.setup>, name: RegExp, option: string) {
    const select = screen.getByRole('combobox', { name });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(select);
    await user.click(screen.getByRole('option', { name: option }));
}

function dataQueryCounts() {
    const keys = [
        'summary',
        'inventory',
        'inventoryMetrics',
        'accountHealth',
        'metric',
        'partition',
        'alerts',
        'activeAlerts',
        'recommendations',
        'advisories',
    ] as const;
    return Object.fromEntries(keys.map((key) => [key, queries[key].mock.calls.length]));
}

beforeEach(() => {
    vi.resetAllMocks();
    initialTarget = 'overview';
    queries.aiFeaturesEnabled.mockImplementation((_input: unknown, next: typeof aiCallbacks) => {
        aiCallbacks = next;
        next.onData(true);
        return { unsubscribe: queries.unsubscribeAI };
    });
    queries.navigation.mockImplementation((_input: unknown, next: NavigationCallbacks) => {
        callbacks = next;
        next.onData({ type: 'navigate', target: initialTarget, revision: 0 });
        return { unsubscribe: queries.unsubscribe };
    });
    queries.summary.mockResolvedValue(summary);
    queries.inventory.mockResolvedValue({ supported: true, available: true, rows });
    queries.accountAction.mockResolvedValue({ status: 'completed' } satisfies AccountActionResult);
    queries.showErrorMessage.mockResolvedValue(undefined);
    queries.inventoryMetrics.mockResolvedValue({ available: false, reason: 'noData', metrics: {} });
    queries.accountHealth.mockResolvedValue({ available: false, reason: 'noData', generatedAt: 0 });
    queries.metric.mockImplementation(({ metric, timeRange }: { metric: MetricKey; timeRange: TimeRange }) =>
        Promise.resolve({ metric, timeRange, available: false, reason: 'noData', points: [], generatedAt: 0 }),
    );
    queries.partition.mockResolvedValue({ available: false, reason: 'noData', tiles: [] });
    queries.activeAlerts.mockResolvedValue(activeAlertSummary());
    queries.alerts.mockImplementation(
        async ({
            timeRange,
            monitorCondition,
        }: {
            timeRange: AlertTimeRange;
            monitorCondition: AlertMonitorCondition;
        }) => ({
            available: true,
            alerts: [],
            criticalCount: 0,
            warningCount: 0,
            timeRange,
            monitorCondition,
            generatedAt: 0,
        }),
    );
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

function activeAlertSummary(severity?: 'Critical' | 'Warning'): ActiveAlertSummary {
    return {
        available: true,
        totalCount: severity ? 1 : 0,
        criticalCount: severity === 'Critical' ? 1 : 0,
        warningCount: severity === 'Warning' ? 1 : 0,
        generatedAt: 0,
    };
}

afterEach(() => vi.restoreAllMocks());

describe('account-wide health collection', () => {
    it.each([false, true])('does not wait for inventory metrics (Serverless: %s)', async (isServerless) => {
        const pending = Promise.withResolvers<unknown>();
        queries.summary.mockResolvedValue({
            ...summary,
            isServerless,
            metricApplicability: getAccountMetricApplicability(isServerless),
        });
        queries.inventoryMetrics.mockReturnValue(pending.promise);
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        render(<AccountOverview />, { wrapper: Wrapper });
        try {
            expect(await screen.findByText('Account health: Healthy')).toBeVisible();
            expect(queries.accountHealth).toHaveBeenCalledExactlyOnceWith();
            expect(queries.inventoryMetrics).toHaveBeenCalledOnce();
            expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-disabled', 'true');
        } finally {
            await act(async () => pending.resolve({ available: false, reason: 'noData', metrics: {} }));
        }
    });

    it.each(['Healthy', 'Critical', undefined] as const)(
        'raises account health at least to Needs Attention for a Critical container (base: %s)',
        async (baseHealth) => {
            queries.accountHealth.mockResolvedValue({
                available: baseHealth !== undefined,
                health: baseHealth,
                generatedAt: 0,
            });
            queries.inventoryMetrics.mockResolvedValue({
                available: true,
                metrics: {
                    'database/orders': {
                        databaseId: 'database',
                        containerId: 'orders',
                        throttled: true,
                        health: 'Critical',
                    },
                },
            });
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            expect(
                await screen.findByText(
                    `Account health: ${baseHealth === 'Critical' ? 'Critical' : 'Needs Attention'}`,
                ),
            ).toBeVisible();
            const tab = screen.getByRole('tab', { name: 'Databases and Containers' });
            expect(tab).toHaveAccessibleName('Databases and Containers');
            expect(tab).toHaveTextContent('Databases and Containers');
            expect(tab).toHaveAccessibleDescription(
                'Critical containers: 1. Account health is at least Needs Attention. Critical containers appear first in the table.',
            );
            expect(tab.querySelector('svg')).toBeInTheDocument();
            await user.click(tab);
            expect(within(screen.getByRole('table', { name: 'Containers' })).getByText('Critical')).toBeVisible();
            await user.type(screen.getByRole('textbox', { name: 'Search containers or databases' }), 'products');
            expect(
                within(screen.getByRole('table', { name: 'Containers' })).queryByText('Critical'),
            ).not.toBeInTheDocument();
            expect(tab).toHaveAccessibleDescription(/Critical containers: 1/);
            expect(
                screen.getByText(`Account health: ${baseHealth === 'Critical' ? 'Critical' : 'Needs Attention'}`),
            ).toBeVisible();
        },
    );

    it('shows local warnings without escalating account health, and no indicator for unknown rows', async () => {
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        queries.inventoryMetrics.mockResolvedValue({
            available: true,
            metrics: {
                'database/orders': { health: 'Needs Attention', throttled: false },
                'database/products': { throttled: false },
            },
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByText('Account health: Healthy')).toBeVisible();
        expect(screen.getByRole('tab', { name: 'Databases and Containers' })).toHaveAccessibleDescription(
            'Containers needing attention: 1. These warnings do not escalate account health.',
        );
        queries.inventoryMetrics.mockResolvedValue({
            available: true,
            metrics: { 'database/orders': { throttled: false }, 'database/products': { throttled: false } },
        });
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        await userEvent.setup().click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.getByRole('tab', { name: 'Databases and Containers' })).not.toHaveAccessibleDescription();
        expect(screen.getByRole('tab', { name: 'Databases and Containers' }).querySelector('svg')).toBeNull();
    });

    it('retains tab focus as late Critical container evidence arrives and clears the signal on recovery', async () => {
        const pending = Promise.withResolvers<unknown>();
        queries.inventoryMetrics.mockReturnValueOnce(pending.promise);
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        const tab = await screen.findByRole('tab', { name: 'Databases and Containers' });
        await user.click(tab);
        await act(async () =>
            pending.resolve({
                available: false,
                metrics: { 'database/orders': { health: 'Critical', throttled: true } },
            }),
        );
        expect(tab).toHaveFocus();
        expect(screen.getByRole('tab', { name: 'Databases and Containers' })).toBe(tab);
        expect(tab).toHaveAccessibleDescription(/Critical containers: 1/);
        expect(screen.getByText('Account health: Needs Attention')).toBeVisible();
        queries.inventoryMetrics.mockResolvedValue({
            available: true,
            metrics: { 'database/orders': { health: 'Healthy', throttled: false } },
        });
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        await user.click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.getByText('Account health: Healthy')).toBeVisible();
        expect(tab).not.toHaveAccessibleDescription();
    });

    it('identifies account-wide throttling in Monitoring', async () => {
        queries.accountHealth.mockResolvedValue({
            available: true,
            health: 'Critical',
            hasSustainedThrottling: true,
            generatedAt: 0,
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByText('Account health: Critical')).toBeVisible();
        const tab = screen.getByRole('tab', { name: 'Monitoring' });
        expect(tab).toHaveAccessibleName('Monitoring');
        expect(tab).toHaveAccessibleDescription(/Critical: sustained account-wide throttling/);
    });

    it('points provisioning failures to Account details rather than Monitoring', async () => {
        queries.accountHealth.mockResolvedValue({
            available: true,
            health: 'Critical',
            hasSustainedThrottling: false,
            generatedAt: 0,
        });
        queries.summary.mockResolvedValue({ ...summary, provisioningState: 'Failed' });
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByText('Account health: Critical')).toBeVisible();
        expect(screen.getByRole('tab', { name: 'Monitoring' })).not.toHaveAccessibleDescription();
        expect(screen.getByLabelText('Critical', { selector: `.${badgeClassNames.root}` })).toHaveAccessibleDescription(
            /Resource provisioning state: Failed/,
        );
    });

    it.each(['Critical', 'Warning', 'Advisor'] as const)(
        'identifies the %s health source on Advisories',
        async (source) => {
            queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
            if (source === 'Advisor') {
                queries.recommendations.mockResolvedValue({
                    available: true,
                    recommendations: [],
                    hasHighImpactPerfCost: true,
                    generatedAt: 0,
                });
            } else {
                queries.activeAlerts.mockResolvedValue(activeAlertSummary(source));
            }
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            expect(
                await screen.findByText(`Account health: ${source === 'Critical' ? 'Critical' : 'Needs Attention'}`),
            ).toBeVisible();
            const tab = screen.getByRole('tab', { name: 'Advisories' });
            const explanation =
                source === 'Advisor'
                    ? 'High-impact Performance or Cost recommendations make account health at least Needs Attention.'
                    : source === 'Critical'
                      ? 'Critical active alerts make account health Critical.'
                      : 'Warning active alerts make account health at least Needs Attention.';
            expect(tab).toHaveAccessibleName('Advisories');
            expect(tab).toHaveTextContent('Advisories');
            expect(tab).toHaveAccessibleDescription(explanation);
            const label = within(tab.querySelector(`.${tabClassNames.content}`)!).getByText('Advisories');
            const icon = tab.querySelector('svg')!;
            expect(icon).toHaveAttribute('aria-hidden', 'true');
            expect(label.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
            await user.keyboard('{Tab}');
            act(() => tab.focus());
            expect(await screen.findByRole('tooltip')).toHaveTextContent(explanation);
            await user.keyboard('{Escape}');
            expect(tab).toHaveFocus();
        },
    );

    it('clears successful evidence on a failed refresh without changing Essentials provisioning status', async () => {
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        const refresh = await screen.findByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        expect(screen.getByText('Account health: Healthy')).toBeVisible();
        queries.accountHealth.mockRejectedValueOnce(new Error('Monitor unavailable'));
        await user.click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.getByText('Account health: Unknown')).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Account details' }));
        const details = within(screen.getByRole('region', { name: 'Account details' }));
        expect(within(details.getByText('Status').parentElement!).getByText('Online')).toBeVisible();
        expect(queries.accountHealth).toHaveBeenCalledTimes(2);
    });

    it('ignores an old health response after a newer request has completed', async () => {
        const pending = Promise.withResolvers<AccountHealthResult>();
        queries.accountHealth
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 1 });
        render(<OverviewDashboard onAccountDeleted={vi.fn()} />, { wrapper: Wrapper, reactStrictMode: true });
        expect(await screen.findByText('Account health: Healthy')).toBeVisible();
        await act(async () => pending.resolve({ available: true, health: 'Critical', generatedAt: 0 }));
        expect(screen.getByText('Account health: Healthy')).toBeVisible();
    });

    it.each([
        ['noData', 'No data'],
        ['rbac', 'No permission'],
        ['error', 'Unable to load'],
    ] as const)('explains Unknown health for %s while provisioning Status remains Online', async (reason, caption) => {
        queries.accountHealth.mockResolvedValue({ available: false, reason, generatedAt: 0 });
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByText('Account health: Unknown')).toBeVisible();
        const badge = screen.getByLabelText('Unknown', { selector: `.${badgeClassNames.root}` });
        expect(badge).toHaveAttribute('tabindex', '0');
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining(
                `Account-wide request health over the last 1 hour could not be assessed: ${caption}.`,
            ),
        );
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Account details' }));
        const details = within(screen.getByRole('region', { name: 'Account details' }));
        expect(within(details.getByText('Status').parentElement!).getByText('Online')).toBeVisible();
    });
});

describe('Serverless metric selection', () => {
    const serverlessSummary: AccountSummary = {
        ...summary,
        isServerless: true,
        metricApplicability: getAccountMetricApplicability(true),
    };

    it.each([
        { health: 'Healthy', throttled: false, label: 'Passed', reason: undefined },
        { health: 'Critical', throttled: true, label: 'Critical', reason: undefined },
        { health: undefined, throttled: undefined, label: 'Unknown', reason: 'noData' },
        { health: undefined, throttled: undefined, label: 'Unknown', reason: 'rbac' },
        { health: undefined, throttled: undefined, label: 'Unknown', reason: 'error' },
    ])('shows scoped Serverless throttling: $label ($reason)', async ({ health, throttled, label, reason }) => {
        queries.summary.mockResolvedValue(serverlessSummary);
        queries.inventoryMetrics.mockResolvedValue({
            available: true,
            metrics: { 'database/orders': { health, throttled, throttlingReason: reason } },
        });
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const inventory = screen.getByRole('table', { name: 'Containers' });
        expect(within(inventory).getByRole('columnheader', { name: 'Throttling' })).toBeVisible();
        expect(within(inventory).queryByRole('columnheader', { name: 'Health' })).not.toBeInTheDocument();
        const row = within(inventory)
            .getByRole('button', { name: 'orders: show partition health in database' })
            .closest('tr')!;
        const badge = within(row).getByLabelText(label);
        expect(badge).toHaveTextContent(label);
        expect(badge).toHaveAccessibleName(label);
        expect(badge).toHaveAttribute('tabindex', '0');
        expect(badge).toHaveAccessibleDescription(/Uses container request observations, not normalized RU/);
        expect(badge).toHaveAccessibleDescription(/429 responses exceed 1% of all requests for at least 5 minutes/);
        expect(badge).toHaveAccessibleDescription(/not overall container health/);
        const captions: Record<string, string> = {
            noData: 'No data',
            rbac: 'No permission',
            error: 'Unable to load',
        };
        expect(badge).toHaveAccessibleDescription(new RegExp(reason ? captions[reason] : 'Passed means'));
        expect(within(inventory).queryByText('Healthy')).not.toBeInTheDocument();
    });

    it.each([
        ['noData', 'No data'],
        ['rbac', 'No permission'],
        ['error', 'Unable to load'],
    ] as const)('preserves the %s request-check fallback for missing inventory metrics', async (reason, caption) => {
        queries.summary.mockResolvedValue(serverlessSummary);
        queries.inventoryMetrics.mockResolvedValue({
            available: false,
            metrics: {},
            throttlingFallbackReason: reason,
        });
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const inventory = screen.getByRole('table', { name: 'Containers' });
        const row = within(inventory)
            .getByRole('button', { name: 'orders: show partition health in database' })
            .closest('tr')!;
        const badge = within(row).getByLabelText('Unknown');
        expect(badge).toHaveTextContent('Unknown');
        expect(badge).toHaveAccessibleName('Unknown');
        expect(badge).toHaveAccessibleDescription(
            expect.stringContaining(`Request observations unavailable: ${caption}.`),
        );
    });

    it('uses the late account summary for the default without waiting for metric samples', async () => {
        const pending = Promise.withResolvers<AccountSummary>();
        queries.summary.mockReturnValue(pending.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(screen.queryByRole('button', { name: /^Total request units/ })).not.toBeInTheDocument();
        await waitFor(() => expect(queries.inventory).toHaveBeenCalled());
        expect(queries.partition).not.toHaveBeenCalled();
        await act(async () => pending.resolve(serverlessSummary));
        expect(await screen.findByRole('button', { name: /^Total request units/ })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        expect(screen.queryByRole('button', { name: /^Normalized RU/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Provisioned throughput/ })).not.toBeInTheDocument();
        await waitFor(() =>
            expect(queries.partition).toHaveBeenCalledWith(expect.objectContaining({ mode: 'storage' })),
        );
        expect(queries.partition.mock.calls.every(([input]) => input.mode === 'storage')).toBe(true);
    });

    it('preserves an applicable selection through Refresh, time and database scope changes', async () => {
        const user = userEvent.setup();
        queries.summary.mockResolvedValue(serverlessSummary);
        render(<AccountOverview />, { wrapper: Wrapper });
        const tile = await screen.findByRole('button', { name: /^Total requests/ });
        await user.click(tile);
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        await user.click(refresh);
        await waitFor(() => expect(queries.summary).toHaveBeenCalledTimes(2));
        await chooseHeaderOption(user, /Metric time range/, 'Last hour');
        await chooseHeaderOption(user, /Database scope for metrics/, 'database');
        await waitFor(() =>
            expect(queries.metric).toHaveBeenCalledWith(
                expect.objectContaining({
                    metric: 'totalRequests',
                    timeRange: '1H',
                    databaseId: 'database',
                }),
            ),
        );
        expect(screen.getByRole('button', { name: /^Total requests/ })).toBe(tile);
        expect(tile).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Unknown');
    });

    it('redirects a deep link to a Serverless-inapplicable metric to consumed RU', async () => {
        initialTarget = 'provisionedThroughput';
        queries.summary.mockResolvedValue(serverlessSummary);
        render(<AccountOverview />, { wrapper: Wrapper });
        const region = await screen.findByRole('region', { name: 'Total request units trend' });
        expect(region).toHaveFocus();
        expect(screen.getByRole('button', { name: /^Total request units/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([
        ['noData', 'No telemetry available for this selection yet.'],
        ['rbac', 'Not enough permissions: your role is missing Monitoring Reader.'],
        ['error', 'Unable to load telemetry. Try refreshing.'],
    ])('keeps storage distribution visible with its real %s outcome and no mode toggle', async (reason, message) => {
        const user = userEvent.setup();
        queries.summary.mockResolvedValue(serverlessSummary);
        queries.partition.mockResolvedValue({ mode: 'storage', available: false, reason, tiles: [] });
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        expect(await screen.findByText('Storage distribution')).toBeVisible();
        expect(screen.getByText('Partition Key Distribution Health')).toBeVisible();
        const partitionCard = screen
            .getByText('Partition Key Distribution Health')
            .closest<HTMLElement>(`.${cardClassNames.root}`)!;
        expect(await within(partitionCard).findByText(message)).toBeVisible();
        expect(screen.queryByRole('toolbar', { name: 'Partition distribution measure' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'By RU Share' })).not.toBeInTheDocument();
        expect(screen.getByText(/^Physical-partition storage distribution/)).toBeVisible();
        const inventory = screen.getByRole('table', { name: 'Containers' });
        expect(within(inventory).queryByText('Not applicable')).not.toBeInTheDocument();
        expect(within(inventory).queryByRole('columnheader', { name: 'Throughput' })).not.toBeInTheDocument();
        expect(within(inventory).queryByRole('columnheader', { name: 'Peak normalized RU' })).not.toBeInTheDocument();
        expect(within(inventory).getAllByText('Unknown')).toHaveLength(rows.length);
        expect(within(inventory).queryByText('0%')).not.toBeInTheDocument();
        expect(within(inventory).queryByText('Healthy')).not.toBeInTheDocument();
        await chooseHeaderOption(user, /Metric time range/, 'Last hour');
        await waitFor(() =>
            expect(queries.partition).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    mode: 'storage',
                    timeRange: '1H',
                }),
            ),
        );
    });

    it.each(['Critical', 'Needs Attention'] as const)(
        'retains active alert health %s without normalized RU',
        async (health) => {
            queries.summary.mockResolvedValue(serverlessSummary);
            queries.activeAlerts.mockResolvedValue(activeAlertSummary(health === 'Critical' ? 'Critical' : 'Warning'));
            render(<AccountOverview />, { wrapper: Wrapper });
            expect(await screen.findByText(`Account health: ${health}`)).toBeVisible();
        },
    );

    it('retains 429 health even when storage is unavailable', async () => {
        queries.summary.mockResolvedValue(serverlessSummary);
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Critical', generatedAt: 0 });
        queries.inventoryMetrics.mockResolvedValue({
            available: false,
            reason: 'rbac',
            metrics: {
                'database/orders': {
                    databaseId: 'database',
                    containerId: 'orders',
                    throttled: true,
                    health: 'Critical',
                },
            },
        });
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        expect(await screen.findByText('Account health: Critical')).toBeVisible();
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        expect(within(screen.getByRole('table', { name: 'Containers' })).getByText('Critical')).toBeVisible();
    });

    it.each([undefined, -1, 0, 4000])(
        'retains Provisioned RU default and both controls with cap %s',
        async (totalThroughputLimit) => {
            queries.summary.mockResolvedValue({ ...summary, totalThroughputLimit });
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
            const ru = screen.getByRole('button', { name: 'By RU Share' });
            const storage = screen.getByRole('button', { name: 'By Storage Share' });
            expect(ru).toHaveTextContent('By RU Share');
            expect(ru).toHaveAccessibleName('By RU Share');
            expect(storage).toHaveTextContent('By Storage Share');
            expect(storage).toHaveAccessibleName('By Storage Share');
            expect(ru).toHaveAttribute('aria-pressed', 'true');
            expect(queries.partition).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ru' }));
            await user.click(storage);
            await waitFor(() =>
                expect(queries.partition).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'storage' })),
            );
            await user.click(ru);
            await waitFor(() =>
                expect(queries.partition).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'ru' })),
            );
        },
    );
});

describe('header update feedback', () => {
    async function showReadyOverview() {
        render(<AccountOverview />, { wrapper: Wrapper });
        const refresh = await screen.findByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        queries.announce.mockClear();
        return refresh;
    }

    it('does not present initial advisory loading as a second Refresh after the charts have loaded', async () => {
        const pending = Promise.withResolvers<unknown>();
        queries.advisories.mockReturnValueOnce(pending.promise);
        queries.metric.mockImplementation(({ metric, timeRange }: { metric: MetricKey; timeRange: TimeRange }) =>
            Promise.resolve({ metric, timeRange, available: true, points: [], generatedAt: Date.now() }),
        );
        render(<AccountOverview />, { wrapper: Wrapper });
        try {
            const refresh = await screen.findByRole('button', { name: 'Refresh' });
            await screen.findByText(/^Charts generated at/);
            await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
            expect(dataQueryCounts()).toEqual({
                summary: 1,
                inventory: 1,
                inventoryMetrics: 1,
                accountHealth: 1,
                metric: METRIC_ORDER.length,
                partition: 1,
                alerts: 1,
                activeAlerts: 1,
                recommendations: 1,
                advisories: 1,
            });
            expect(refresh).toHaveAttribute('aria-busy', 'false');
            expect(refresh).toHaveAttribute('aria-disabled', 'true');
            expect(refresh).toHaveAccessibleDescription('Account data is still loading.');
            expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
            expect(queries.announce).not.toHaveBeenCalled();
        } finally {
            await act(async () => pending.resolve({ available: true, advisories: [], generatedAt: Date.now() }));
        }
    });

    it.each([
        'summary',
        'inventory',
        'inventoryMetrics',
        'metric',
        'partition',
        'alerts',
        'recommendations',
        'advisories',
    ] as const)('keeps manual Refresh busy until the slow %s request settles', async (source) => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const response: unknown = await queries[source].mock.results[0].value;
        const pending = Promise.withResolvers<unknown>();
        queries[source].mockReturnValueOnce(pending.promise);
        await user.click(refresh);
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        expect(refresh).toHaveFocus();
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
        expect(refresh).toHaveAccessibleDescription('Updating…');
        const counts = dataQueryCounts();
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            const select = screen.getByRole('combobox', { name });
            expect(select).toHaveAttribute('aria-disabled', 'true');
            await user.click(select);
        }
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        await user.click(refresh);
        expect(dataQueryCounts()).toEqual(counts);
        expect(queries.announce).toHaveBeenCalledExactlyOnceWith('Updating Account Overview…', { polite: true });
        await act(async () => pending.resolve(response));
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
        expect(queries.announce).toHaveBeenLastCalledWith('Account Overview update finished.', { polite: true });
        expect(refresh).toHaveFocus();
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            expect(screen.getByRole('combobox', { name })).not.toHaveAttribute('aria-disabled', 'true');
        }
    });

    it('locks both filters until initial advisory loading finishes without launching extra queries', async () => {
        const user = userEvent.setup();
        const advisories = Promise.withResolvers<unknown>();
        queries.advisories.mockReturnValueOnce(advisories.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        try {
            const refresh = await screen.findByRole('button', { name: 'Refresh' });
            await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
            const counts = dataQueryCounts();
            for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
                const select = screen.getByRole('combobox', { name });
                expect(select).toHaveAttribute('aria-disabled', 'true');
                await user.click(select);
            }
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
            expect(dataQueryCounts()).toEqual(counts);
            expect(refresh).toHaveAttribute('aria-busy', 'false');
            expect(refresh).toHaveAttribute('aria-disabled', 'true');
            expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
            expect(queries.announce).not.toHaveBeenCalled();
        } finally {
            await act(async () => advisories.resolve({ available: true, advisories: [], generatedAt: Date.now() }));
        }
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        expect(queries.metric).toHaveBeenLastCalledWith(expect.objectContaining({ databaseId: 'database' }));
        expect(queries.advisories).toHaveBeenCalledTimes(1);
    });

    it.each(['metric', 'inventoryMetrics', 'partition'] as const)(
        'shows time-range activity until %s finishes, retaining the selected period',
        async (source) => {
            const user = userEvent.setup();
            const refresh = await showReadyOverview();
            const response: unknown = await queries[source].mock.results[0].value;
            const pending = Promise.withResolvers<unknown>();
            queries[source].mockReturnValueOnce(pending.promise);
            await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
            expect(refresh).toHaveAttribute('aria-busy', 'true');
            const select = screen.getByRole('combobox', { name: /^Metric time range:/ });
            expect(select).toHaveTextContent('Last 7 days');
            expect(select).toHaveAttribute('aria-disabled', 'true');
            expect(select).toHaveFocus();
            expect(select).toHaveAccessibleDescription('Updating…');
            await act(async () => pending.resolve(response));
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(select).not.toHaveAttribute('aria-disabled', 'true');
            expect(select).toHaveFocus();
        },
    );

    it.each(['success', 'failure'])(
        'blocks another database/time change until the current scope settles with %s',
        async (outcome) => {
            const user = userEvent.setup();
            const refresh = await showReadyOverview();
            const response: unknown = await queries.metric.mock.results[0].value;
            const pending = Promise.withResolvers<unknown>();
            queries.metric.mockReturnValueOnce(pending.promise);
            await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
            expect(refresh).toHaveAttribute('aria-busy', 'true');
            const counts = dataQueryCounts();
            for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
                const select = screen.getByRole('combobox', { name });
                expect(select).toHaveAttribute('aria-disabled', 'true');
                await user.click(select);
            }
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
            expect(dataQueryCounts()).toEqual(counts);
            expect(queries.announce).toHaveBeenCalledTimes(1);
            await act(async () => {
                if (outcome === 'success') {
                    pending.resolve(response);
                } else {
                    pending.reject(new Error('Metric request failed'));
                }
            });
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveFocus();
            await chooseHeaderOption(user, /^Database scope for metrics:/, 'All databases');
            expect(queries.metric).toHaveBeenCalledTimes(counts.metric + METRIC_ORDER.length);
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveTextContent(
                'All databases',
            );
        },
    );

    it.each([
        ['Metric time range', 'Last 7 days', false],
        ['Metric time range', 'Last 7 days', true],
        ['Database scope for metrics', 'database', false],
        ['Database scope for metrics', 'database', true],
    ] as const)('%s retains %s and keyboard focus after loading (failure: %s)', async (label, value, fails) => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const response: unknown = await queries.metric.mock.results[0].value;
        const pending = Promise.withResolvers<unknown>();
        queries.metric.mockReturnValueOnce(pending.promise);
        const select = screen.getByRole('combobox', { name: new RegExp(`^${label}:`) });
        select.focus();
        await user.keyboard('{Enter}{ArrowDown}{Enter}');
        expect(select).toHaveTextContent(value);
        expect(select).toHaveAccessibleName(`${label}: ${value}`);
        expect(select).toHaveFocus();
        expect(select).toHaveAttribute('aria-disabled', 'true');
        const counts = dataQueryCounts();
        await user.keyboard('{ArrowDown}{Enter} {Home}{End}database');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(dataQueryCounts()).toEqual(counts);
        await act(async () => {
            if (fails) {
                pending.reject(new Error('Metric request failed'));
            } else {
                pending.resolve(response);
            }
        });
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(select).not.toHaveAttribute('aria-disabled', 'true');
        expect(select).toHaveFocus();
    });

    it.each([
        [/^Metric time range:/, 'Last 7 days'],
        [/^Database scope for metrics:/, 'database'],
    ] as const)('does not restore %s focus if the user leaves during loading', async (name, option) => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const response: unknown = await queries.metric.mock.results[0].value;
        const pending = Promise.withResolvers<unknown>();
        queries.metric.mockReturnValueOnce(pending.promise);
        await chooseHeaderOption(user, name, option);
        const destination = screen.getByRole('tab', { name: 'Advisories' });
        await user.click(destination);
        await act(async () => pending.resolve(response));
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(destination).toHaveFocus();
    });

    it('blocks another period selection until the current inventory-metrics request finishes', async () => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const response: unknown = await queries.inventoryMetrics.mock.results[0].value;
        const pending = Promise.withResolvers<unknown>();
        queries.inventoryMetrics.mockReturnValueOnce(pending.promise);
        await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        const select = screen.getByRole('combobox', { name: /^Metric time range:/ });
        expect(select).toHaveAttribute('aria-disabled', 'true');
        await user.click(select);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(queries.inventoryMetrics).toHaveBeenCalledTimes(2);
        await act(async () => pending.resolve(response));
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        await chooseHeaderOption(user, /^Metric time range:/, 'Last hour');
        expect(queries.inventoryMetrics).toHaveBeenCalledTimes(3);
        expect(queries.inventoryMetrics).toHaveBeenLastCalledWith({ timeRange: '1H' });
    });

    it.each(['summary', 'inventory', 'inventoryMetrics', 'partition'] as const)(
        'unlocks after a failed %s request, reports the error, and permits retry',
        async (source) => {
            const user = userEvent.setup();
            const refresh = await showReadyOverview();
            const pending = Promise.withResolvers<unknown>();
            queries[source].mockReturnValueOnce(pending.promise);
            await user.click(refresh);
            expect(refresh).toHaveAttribute('aria-busy', 'true');
            await act(async () => pending.reject(new Error('Refresh failed')));
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
                expect(screen.getByRole('combobox', { name })).not.toHaveAttribute('aria-disabled', 'true');
            }
            expect(screen.getByRole('group', { name: 'Error' })).toHaveTextContent(
                'Account data could not be refreshed.',
            );
            await user.click(refresh);
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
        },
    );

    it('waits for remaining requests after an early failure instead of ending Refresh immediately', async () => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const response: unknown = await queries.advisories.mock.results[0].value;
        const pending = Promise.withResolvers<unknown>();
        queries.summary.mockRejectedValueOnce(new Error('Summary failed'));
        queries.advisories.mockReturnValueOnce(pending.promise);
        await user.click(refresh);
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        expect(queries.announce).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve(response));
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.getByRole('group', { name: 'Error' })).toHaveTextContent('Account data could not be refreshed.');
    });

    it.each(['Monitoring', 'Databases and Containers', 'Advisories'])(
        'does not request data on timers or visibility changes while %s is selected',
        async (tab) => {
            const user = userEvent.setup();
            const refresh = await showReadyOverview();
            const counts = dataQueryCounts();
            await user.click(screen.getByRole('tab', { name: tab }));
            vi.useFakeTimers();
            try {
                const visibility = vi.spyOn(document, 'visibilityState', 'get');
                await act(async () => {
                    visibility.mockReturnValue('hidden');
                    fireEvent(document, new Event('visibilitychange'));
                    await vi.advanceTimersByTimeAsync(300_000);
                    visibility.mockReturnValue('visible');
                    fireEvent(document, new Event('visibilitychange'));
                    await vi.advanceTimersByTimeAsync(300_000);
                });
                expect(dataQueryCounts()).toEqual(counts);
                expect(refresh).toHaveAttribute('aria-busy', 'false');
                expect(queries.announce).not.toHaveBeenCalled();
            } finally {
                vi.restoreAllMocks();
                vi.useRealTimers();
            }
        },
    );

    it('reloads every section exactly once with manual Refresh', async () => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const counts = dataQueryCounts();
        await user.click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(dataQueryCounts()).toEqual(
            Object.fromEntries(
                Object.entries(counts).map(([key, count]) => [
                    key,
                    count + (key === 'metric' ? METRIC_ORDER.length : 1),
                ]),
            ),
        );
    });

    it.each(['opening', 'manual Refresh'])('does not overlap slow advisory collection during %s', async (trigger) => {
        const pending = Promise.withResolvers<unknown>();
        const response: unknown = await queries.advisories();
        queries.advisories.mockClear();
        if (trigger === 'opening') {
            queries.advisories.mockReturnValueOnce(pending.promise);
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('button', { name: 'Refresh' });
        } else {
            const refresh = await showReadyOverview();
            queries.advisories.mockReturnValueOnce(pending.promise);
            fireEvent.click(refresh);
        }
        await waitFor(() => expect(queries.partition).toHaveBeenCalled());
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh).toHaveAttribute('aria-busy', String(trigger === 'manual Refresh'));
        expect(refresh).toHaveAttribute('aria-disabled', 'true');
        const counts = dataQueryCounts();
        vi.useFakeTimers();
        try {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(180_000);
                fireEvent(document, new Event('visibilitychange'));
                fireEvent.click(refresh);
            });
            expect(dataQueryCounts()).toEqual(counts);
            expect(refresh).toHaveAttribute('aria-busy', String(trigger === 'manual Refresh'));
            expect(refresh).toHaveAttribute('aria-disabled', 'true');
            await act(async () => pending.resolve(response));
            expect(refresh).toHaveAttribute('aria-busy', 'false');
            expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
        } finally {
            vi.restoreAllMocks();
            vi.useRealTimers();
        }
    });

    it.each(['time range', 'database scope', 'alert window', 'partition measure', 'partition container'])(
        'reloads only dependent data when changing %s',
        async (filter) => {
            const user = userEvent.setup();
            const refresh = await showReadyOverview();
            const counts = dataQueryCounts();
            const expected = { ...counts };
            if (filter === 'time range') {
                await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
                expected.metric += METRIC_ORDER.length;
                expected.inventoryMetrics++;
                expected.partition++;
            } else if (filter === 'database scope') {
                await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
                expected.metric += METRIC_ORDER.length;
            } else if (filter === 'alert window') {
                await user.click(screen.getByRole('tab', { name: 'Advisories' }));
                await user.click(
                    within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', {
                        name: '30d',
                    }),
                );
                expected.alerts++;
            } else {
                await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
                await user.click(
                    screen.getByRole('button', {
                        name:
                            filter === 'partition measure'
                                ? 'By Storage Share'
                                : 'products: show partition health in database',
                    }),
                );
                expected.partition++;
            }
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(dataQueryCounts()).toEqual(expected);
        },
    );

    it('publishes chart generation time on completion, not opening or an unrelated filter change', async () => {
        const user = userEvent.setup();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 14, 12));
        const pending = Promise.withResolvers<unknown>();
        queries.metric.mockImplementation(({ metric, timeRange }: { metric: MetricKey; timeRange: TimeRange }) =>
            Promise.resolve({ metric, timeRange, available: true, points: [], generatedAt: Date.now() }),
        );
        queries.metric.mockReturnValueOnce(pending.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        const refresh = await screen.findByRole('button', { name: 'Refresh' });
        expect(screen.queryByText(/^Charts generated at/)).not.toBeInTheDocument();
        const generatedAt = Date.UTC(2026, 9, 14, 12, 1);
        clock.mockReturnValue(generatedAt);
        await act(async () =>
            pending.resolve({
                metric: METRIC_ORDER[0],
                timeRange: '24H',
                available: true,
                points: [],
                generatedAt,
            }),
        );
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        const timestamp = screen.getByText(/^Charts generated at/);
        expect(timestamp).toHaveAttribute('datetime', new Date(generatedAt).toISOString());
        clock.mockReturnValue(generatedAt + 60_000);
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        await user.click(
            within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '30d' }),
        );
        expect(timestamp).toHaveAttribute('datetime', new Date(generatedAt).toISOString());
        await user.click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(timestamp).toHaveAttribute('datetime', new Date(generatedAt + 60_000).toISOString());
        queries.metric.mockRejectedValue(new Error('Metrics unavailable'));
        await user.click(refresh);
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.queryByText(/^Charts generated at/)).not.toBeInTheDocument();
    });

    it('updates the timestamp after each completed, serialized database-scope load', async () => {
        const user = userEvent.setup();
        const refresh = await showReadyOverview();
        const older = Promise.withResolvers<void>();
        const newer = Promise.withResolvers<void>();
        queries.metric.mockImplementation(
            ({ metric, timeRange, databaseId }: { metric: MetricKey; timeRange: TimeRange; databaseId?: string }) =>
                (databaseId ? older.promise : newer.promise).then(() => ({
                    metric,
                    timeRange,
                    databaseId,
                    available: true,
                    points: [],
                    generatedAt: Date.now(),
                })),
        );
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        const generatedAt = Date.UTC(2026, 9, 14, 12);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(generatedAt);
        await act(async () => older.resolve());
        await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
        expect(screen.getByText(/^Charts generated at/)).toHaveAttribute(
            'datetime',
            new Date(generatedAt).toISOString(),
        );
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'All databases');
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        clock.mockReturnValue(generatedAt + 60_000);
        await act(async () => newer.resolve());
        expect(screen.getByText(/^Charts generated at/)).toHaveAttribute(
            'datetime',
            new Date(generatedAt + 60_000).toISOString(),
        );
    });
});

describe('Account Overview account actions', () => {
    it('keeps Data Modeler hidden until AI availability is received and follows live changes', async () => {
        queries.aiFeaturesEnabled.mockImplementation((_input: unknown, next: typeof aiCallbacks) => {
            aiCallbacks = next;
            return { unsubscribe: queries.unsubscribeAI };
        });
        const { unmount } = render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
        const counts = dataQueryCounts();
        expect(screen.queryByRole('button', { name: 'Try Data Modeler' })).not.toBeInTheDocument();
        act(() => aiCallbacks.onData(false));
        expect(screen.queryByRole('button', { name: 'Try Data Modeler' })).not.toBeInTheDocument();
        act(() => aiCallbacks.onData(true));
        expect(screen.getByRole('button', { name: 'Try Data Modeler' })).toBeEnabled();
        act(() => aiCallbacks.onData(false));
        expect(screen.queryByRole('button', { name: 'Try Data Modeler' })).not.toBeInTheDocument();
        expect(
            screen.queryByText('Design containers, partition keys, and relationships visually.'),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
        expect(dataQueryCounts()).toEqual(counts);
        unmount();
        expect(queries.unsubscribeAI).toHaveBeenCalledOnce();
    });

    it('hides Data Modeler and reports AI availability subscription failures', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('button', { name: 'Try Data Modeler' });
        const error = new Error('Subscription disconnected');
        act(() => aiCallbacks.onError(error));
        expect(screen.queryByRole('button', { name: 'Try Data Modeler' })).not.toBeInTheDocument();
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(
            'Unable to receive Account Overview AI feature availability.',
            error,
        );
    });

    it('launches Data Modeler by keyboard without refreshing the overview', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await waitFor(() => expect(queries.partition).toHaveBeenCalledTimes(1));
        const counts = dataQueryCounts();
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(modeler).toHaveTextContent('Try Data Modeler');
        expect(modeler).toHaveAccessibleName('Try Data Modeler');
        expect(modeler).toBeEnabled();
        expect(modeler).not.toHaveAttribute('aria-disabled', 'true');
        screen.getByRole('button', { name: 'Delete account' }).focus();
        await user.tab();
        expect(modeler).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'openDataModeler' });
        await waitFor(() => expect(modeler).toBeEnabled());
        expect(dataQueryCounts()).toEqual(counts);
    });

    it.each([
        ['View Cost', 'openCosts'],
        ['View JSON', 'openJson'],
        ['Try Data Modeler', 'openDataModeler'],
    ] as const)('routes %s without refreshing data or resetting metric filters', async (label, action) => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        const counts = dataQueryCounts();
        const button = screen.getByRole('button', { name: label });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        await user.click(button);
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action });
        await waitFor(() => expect(button).toBeEnabled());
        expect(dataQueryCounts()).toEqual(counts);
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveTextContent('Last 7 days');
        expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveTextContent('database');
        expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
    });

    it('blocks duplicate and cross-toolbar actions while a mutation is pending, then unlocks on cancellation', async () => {
        const user = userEvent.setup();
        const pending = Promise.withResolvers<AccountActionResult>();
        queries.accountAction.mockReturnValueOnce(pending.promise);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        queries.announce.mockClear();
        const counts = dataQueryCounts();
        const addDatabase = screen.getByRole('button', { name: 'Add database' });
        const json = screen.getByRole('button', { name: 'View JSON' });
        act(() => {
            fireEvent.click(addDatabase);
            fireEvent.click(addDatabase);
            fireEvent.click(json);
        });
        const actions = within(screen.getByRole('region', { name: 'Account actions' }));
        expect(actions.queryByRole('status')).not.toBeInTheDocument();
        expect(queries.announce).toHaveBeenCalledExactlyOnceWith('Account action in progress…', { polite: true });
        for (const label of ['Add database', 'Delete account', 'View Cost', 'View JSON']) {
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
        expect(actions.queryByRole('status')).not.toBeInTheDocument();
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
    ] as const)('dims and makes the entire Overview inert while %s is pending', async (label, action) => {
        const user = userEvent.setup();
        const pending = Promise.withResolvers<AccountActionResult>();
        queries.accountAction.mockReturnValueOnce(pending.promise);
        const { container } = render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        const trigger = screen.getByRole('button', { name: label });
        const dashboard = container.querySelector('[aria-busy]')!;
        expect(dashboard).not.toHaveAttribute('inert');
        await user.click(trigger);
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith(
            action === 'createContainer' ? { action, databaseId: 'database' } : { action },
        );
        expect(dashboard).toHaveAttribute('inert');
        expect(dashboard).toHaveAttribute('aria-busy', 'true');
        for (const control of [
            screen.getByRole('tab', { name: 'Advisories' }),
            screen.getByRole('button', { name: 'Refresh' }),
            screen.getByRole('combobox', { name: /^Database scope for metrics:/ }),
        ]) {
            expect(dashboard).toContainElement(control);
        }
        const overlay = dashboard.nextElementSibling!;
        expect(overlay).toHaveAttribute('aria-hidden', 'true');
        expect(overlay).toHaveStyle({ position: 'fixed', inset: '0' });
        const pointerDown = createEvent.pointerDown(overlay, { bubbles: true, cancelable: true });
        fireEvent(overlay, pointerDown);
        expect(pointerDown.defaultPrevented).toBe(true);
        await user.click(overlay);
        expect(dashboard).toHaveAttribute('inert');
        expect(queries.accountAction).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Account action in progress…')).not.toBeInTheDocument();
        trigger.blur();
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        await act(async () => pending.resolve({ status: 'cancelled' }));
        expect(dashboard).not.toHaveAttribute('inert');
        expect(dashboard).toHaveAttribute('aria-busy', 'false');
        expect(overlay).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it.each(['completed', 'cancelled', 'failed'] as const)(
        'unblocks creation after %s without stealing focus from another VS Code editor',
        async (outcome) => {
            const user = userEvent.setup();
            const pending = Promise.withResolvers<AccountActionResult>();
            queries.accountAction.mockReturnValueOnce(pending.promise);
            const { container } = render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            const trigger = screen.getByRole('button', { name: 'Add database' });
            await user.click(trigger);
            const dashboard = container.querySelector('[inert]')!;
            const overlay = dashboard.nextElementSibling!;
            trigger.blur();
            vi.spyOn(document, 'hasFocus').mockReturnValue(false);
            const focus = vi.spyOn(trigger, 'focus');
            await act(async () => {
                if (outcome === 'failed') {
                    pending.reject(new Error('Creation failed'));
                } else {
                    pending.resolve({ status: outcome });
                }
            });
            expect(dashboard).not.toHaveAttribute('inert');
            expect(overlay).not.toBeInTheDocument();
            expect(focus).not.toHaveBeenCalled();
            expect(trigger).toBeEnabled();
            expect(queries.inventory).toHaveBeenCalledTimes(outcome === 'completed' ? 2 : 1);
            expect(screen.queryAllByRole('group', { name: 'Error' })).toHaveLength(outcome === 'failed' ? 1 : 0);
        },
    );

    it.each(['View Cost', 'View JSON', 'Delete account'])('does not dim Overview for %s', async (label) => {
        const user = userEvent.setup();
        const pending = Promise.withResolvers<AccountActionResult>();
        queries.accountAction.mockReturnValueOnce(pending.promise);
        const { container } = render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await user.click(screen.getByRole('button', { name: label }));
        expect(container.querySelector('[aria-busy]')).not.toHaveAttribute('inert');
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
        await act(async () => pending.resolve({ status: 'cancelled' }));
    });

    it.each(['completed', 'cancelled', 'failed'] as const)(
        'handles account-scoped Add container with %s outcome without changing the header database scope',
        async (outcome) => {
            const user = userEvent.setup();
            const pending = Promise.withResolvers<AccountActionResult>();
            queries.accountAction.mockReturnValueOnce(pending.promise);
            const { container } = render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            await waitFor(() => expect(queries.inventory).toHaveBeenCalledTimes(1));
            const scope = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
            const trigger = screen.getByRole('button', { name: 'Add container' });
            expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
            await user.click(trigger);
            expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({
                action: 'createContainer',
                databaseId: undefined,
            });
            const dashboard = container.querySelector('[aria-busy]')!;
            expect(dashboard).toHaveAttribute('inert');
            await act(async () => {
                if (outcome === 'failed') {
                    pending.reject(new Error('Database picker failed'));
                } else {
                    pending.resolve({ status: outcome });
                }
            });
            expect(dashboard).not.toHaveAttribute('inert');
            expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
            expect(scope).toHaveTextContent('All databases');
            expect(queries.inventory).toHaveBeenCalledTimes(outcome === 'completed' ? 2 : 1);
            expect(screen.queryAllByRole('group', { name: 'Error' })).toHaveLength(outcome === 'failed' ? 1 : 0);
        },
    );

    it.each([
        ['Add database', 'createDatabase'],
        ['Add container', 'createContainer'],
        ['Delete account', 'deleteAccount'],
        ['View Cost', 'openCosts'],
        ['View JSON', 'openJson'],
        ['Try Data Modeler', 'openDataModeler'],
    ] as const)('keeps the dashboard and data unchanged when %s is cancelled', async (label, action) => {
        const user = userEvent.setup();
        queries.accountAction.mockResolvedValue({ status: 'cancelled' } satisfies AccountActionResult);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
        const counts = dataQueryCounts();
        const dashboard = screen.getByRole('tablist');
        await user.click(screen.getByRole('button', { name: label }));
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith(
            action === 'createContainer' ? { action, databaseId: 'database' } : { action },
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled());
        expect(screen.getByRole('tablist')).toBe(dashboard);
        expect(dataQueryCounts()).toEqual(counts);
        expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
        expect(screen.queryByText('This Cosmos DB account has been deleted.')).not.toBeInTheDocument();
    });

    it.each(['Add database', 'Add container', 'Delete account', 'View Cost', 'View JSON', 'Try Data Modeler'])(
        'announces a rejected %s mutation without refreshing or unmounting, and allows retry',
        async (label) => {
            const user = userEvent.setup();
            queries.accountAction.mockRejectedValueOnce(new Error('mutation failed'));
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
            const dashboard = screen.getByRole('tablist');
            const counts = dataQueryCounts();
            await user.click(screen.getByRole('button', { name: label }));
            expect(await screen.findByRole('group', { name: 'Error' })).toHaveTextContent(
                'The account action could not be completed. Retry or use the Azure Resources view.',
            );
            expect(screen.getByRole('group', { name: 'Error' })).toBeVisible();
            expect(screen.getByRole('tablist')).toBe(dashboard);
            expect(dataQueryCounts()).toEqual(counts);
            expect(screen.queryByText('This Cosmos DB account has been deleted.')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
            queries.accountAction.mockResolvedValueOnce({ status: 'cancelled' } satisfies AccountActionResult);
            await user.click(screen.getByRole('button', { name: label }));
            expect(queries.accountAction).toHaveBeenCalledTimes(2);
            expect(queries.accountAction.mock.calls[1]).toEqual(queries.accountAction.mock.calls[0]);
            await waitFor(() => expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument());
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
        await user.click(scope);
        expect(screen.getAllByRole('option')).toHaveLength(1);
        await user.keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Add container' })).not.toHaveAttribute('aria-disabled', 'true');
        queries.inventory.mockResolvedValueOnce({ ...emptyInventory, databases: ['new-empty-db'] });
        await user.click(screen.getByRole('button', { name: 'Add database' }));
        expect(queries.accountAction).toHaveBeenCalledExactlyOnceWith({ action: 'createDatabase' });
        expect(queries.inventory).toHaveBeenCalledTimes(2);
        await user.click(scope);
        const newDatabase = await screen.findByRole('option', { name: 'new-empty-db' });
        expect(screen.getByRole('button', { name: 'Add container' })).not.toHaveAttribute('aria-disabled', 'true');
        await user.click(newDatabase);
        expect(scope).toHaveTextContent('new-empty-db');
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
        expect(scope).toHaveTextContent('new-empty-db');
        expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
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
        const dashboard = screen.getByRole('tablist').closest('[inert]')!;
        expect(dashboard).toHaveAttribute('aria-busy', 'true');
        const overlay = dashboard.nextElementSibling!;
        expect(screen.getByRole('button', { name: 'Add database' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'View Cost' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Delete account' }));
        expect(queries.accountAction).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve({ supported: true, available: true, rows }));
        expect(dashboard).not.toHaveAttribute('inert');
        expect(overlay).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add database' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'View Cost' })).toBeEnabled();
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
            expect(await screen.findByRole('group', { name: 'Error' })).toHaveTextContent(
                'Account data could not be refreshed. Try Refresh again.',
            );
            expect(screen.getByRole('group', { name: 'Error' })).toBeVisible();
            expect(screen.getByRole('group', { name: 'Error' })).not.toHaveTextContent(
                'The account action could not be completed.',
            );
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
            await waitFor(() => expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument());
            expect(queries.accountAction).toHaveBeenCalledTimes(1);
            expect(queries.inventory).toHaveBeenCalledTimes(counts.inventory + 1);
            expect(queries.summary).toHaveBeenCalledTimes(counts.summary + 1);
            expect(queries.metric).toHaveBeenCalledTimes(counts.metric + METRIC_ORDER.length);
            expect(queries.alerts).toHaveBeenCalledTimes(counts.alerts + 1);
            expect(queries.recommendations).toHaveBeenCalledTimes(counts.recommendations + 1);
            expect(queries.advisories).toHaveBeenCalledTimes(counts.advisories + 1);
            expect(screen.getByRole('heading', { name: 'refreshed-account' })).toBeVisible();
            const scope = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
            await user.click(scope);
            expect(screen.getByRole('option', { name: 'new-empty-db' })).toBeVisible();
            await user.keyboard('{Escape}');
            await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
            expect(
                screen.getByRole('button', { name: 'new-container: show partition health in database' }),
            ).toBeVisible();
        },
    );

    it('preserves tab, search, partition selection, metric filters and details across scoped creation', async () => {
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
        await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
        await chooseHeaderOption(user, /^Database scope for metrics:/, 'other-empty-db');
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        await user.click(
            within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '30d' }),
        );
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
        expect(screen.getByRole('combobox', { name: /^Select a container for partition health:/ })).toHaveTextContent(
            'products · database',
        );
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveTextContent('Last 7 days');
        expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveTextContent(
            'other-empty-db',
        );
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveAttribute('aria-expanded', 'false');
        expect(queries.partition).toHaveBeenCalledTimes(counts.partition);
        expect(queries.metric).toHaveBeenCalledTimes(counts.metric);
        expect(queries.inventory).toHaveBeenCalledTimes(counts.inventory + 1);
        await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
        expect(screen.getByRole('heading', { name: 'Document count trend' })).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(queries.metric).toHaveBeenLastCalledWith(
            expect.objectContaining({ timeRange: '7D', databaseId: 'other-empty-db', containerId: undefined }),
        );
        expect(queries.alerts).toHaveBeenLastCalledWith({ timeRange: '30d', monitorCondition: 'Fired' });
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        expect(
            within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '30d' }),
        ).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([0, 15_000])(
        'unmounts the dashboard without subsequent data requests after deletion at %s ms',
        async (elapsed) => {
            vi.useFakeTimers();
            const view = render(<AccountOverview />, { wrapper: Wrapper });
            try {
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(elapsed);
                });
                expect(screen.getByRole('tab', { name: 'Monitoring' })).toBeVisible();
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

describe('alert window serialization', () => {
    async function showAlerts() {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Advisories' }));
        return { user, controls: within(screen.getByRole('toolbar', { name: 'Alert time range' })) };
    }

    function alertResult(timeRange: '1d' | '7d' | '30d'): AlertsResult {
        return {
            available: true,
            alerts: [
                {
                    id: timeRange,
                    name: `${timeRange} alert`,
                    severity: 'Informational',
                    rawSeverity: 'Sev4',
                    portalUrl: 'https://example.invalid/alert',
                },
            ],
            criticalCount: 0,
            warningCount: 0,
            timeRange,
            monitorCondition: 'Fired',
            generatedAt: 0,
        };
    }

    it('locks every alert window during initial loading and unlocks after completion', async () => {
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockReturnValueOnce(pending.promise);
        const { user, controls } = await showAlerts();
        for (const button of controls.getAllByRole('button')) {
            expect(button).toHaveAttribute('aria-disabled', 'true');
            expect(button).not.toBeDisabled();
            expect(button).toHaveAccessibleDescription('Alerts are still loading.');
            await user.click(button);
        }
        expect(queries.alerts).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve(alertResult('1d')));
        for (const button of controls.getAllByRole('button')) {
            expect(button).toBeEnabled();
            expect(button).not.toHaveAttribute('aria-disabled', 'true');
            expect(button).not.toHaveAttribute('aria-description');
        }
    });

    it('blocks mouse and keyboard period changes until the previous result arrives', async () => {
        const { user, controls } = await showAlerts();
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockReturnValueOnce(pending.promise);
        await user.click(controls.getByRole('button', { name: '7d' }));
        const next = controls.getByRole('button', { name: '30d' });
        expect(next).toHaveAttribute('aria-disabled', 'true');
        await user.click(next);
        fireEvent.click(next);
        next.focus();
        await user.keyboard('{Enter} ');
        expect(queries.alerts).toHaveBeenCalledTimes(2);
        expect(queries.alerts).toHaveBeenLastCalledWith({ timeRange: '7d', monitorCondition: 'Fired' });
        await act(async () => pending.resolve(alertResult('7d')));
        expect(screen.getByText('7d alert')).toBeVisible();
        queries.alerts.mockResolvedValueOnce(alertResult('30d'));
        await user.click(next);
        expect(queries.alerts).toHaveBeenLastCalledWith({ timeRange: '30d', monitorCondition: 'Fired' });
        expect(await screen.findByText('30d alert')).toBeVisible();
        expect(screen.queryByText('7d alert')).not.toBeInTheDocument();
        await user.click(next);
        expect(queries.alerts).toHaveBeenCalledTimes(3);
    });

    it.each([false, true])(
        'keeps alert windows locked until the whole manual Refresh settles (alerts fail: %s)',
        async (alertsFail) => {
            const { user, controls } = await showAlerts();
            const pending = Promise.withResolvers<unknown>();
            const previous: unknown = await queries.advisories.mock.results[0].value;
            queries.advisories.mockReturnValueOnce(pending.promise);
            if (alertsFail) {
                queries.alerts.mockRejectedValueOnce(new Error('Alert request failed'));
            }
            const refresh = screen.getByRole('button', { name: 'Refresh' });
            await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
            await user.click(refresh);
            for (const button of controls.getAllByRole('button')) {
                expect(button).toHaveAttribute('aria-disabled', 'true');
            }
            expect(queries.alerts).toHaveBeenCalledTimes(2);
            await user.click(controls.getByRole('button', { name: '7d' }));
            expect(queries.alerts).toHaveBeenCalledTimes(2);
            await act(async () => pending.resolve(previous));
            await waitFor(() =>
                expect(controls.getByRole('button', { name: '7d' })).not.toHaveAttribute('aria-disabled', 'true'),
            );
            const failureMessage = screen.queryByRole('group', { name: 'Error' })?.textContent ?? '';
            expect(failureMessage.includes('Account data could not be refreshed.')).toBe(alertsFail);
            expect(queries.showErrorMessage).not.toHaveBeenCalled();
        },
    );

    it('unlocks after a rejected period request, replaces stale alerts and permits another selection', async () => {
        queries.alerts.mockResolvedValueOnce(alertResult('1d'));
        const { user, controls } = await showAlerts();
        queries.alerts.mockRejectedValueOnce(new Error('Alert request failed'));
        await user.click(controls.getByRole('button', { name: '7d' }));
        expect(screen.queryByText('1d alert')).not.toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Error' })).toHaveTextContent('Account data could not be refreshed.');
        const next = controls.getByRole('button', { name: '30d' });
        expect(next).toBeEnabled();
        expect(next).not.toHaveAttribute('aria-disabled', 'true');
        queries.alerts.mockResolvedValueOnce(alertResult('30d'));
        await user.click(next);
        expect(await screen.findByText('30d alert')).toBeVisible();
        expect(queries.showErrorMessage).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves period focus across loading (request fails: %s)', async (fails) => {
        const { user, controls } = await showAlerts();
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockReturnValueOnce(pending.promise);
        controls.getByRole('button', { name: '1d' }).focus();
        await user.keyboard('{ArrowRight}{Enter}');
        const selected = controls.getByRole('button', { name: '7d' });
        expect(selected).toHaveTextContent('7d');
        expect(selected).toHaveAccessibleName('7d');
        expect(selected).toHaveFocus();
        expect(selected).toHaveAttribute('aria-disabled', 'true');
        await user.keyboard('{Enter} ');
        expect(queries.alerts).toHaveBeenCalledTimes(2);
        await act(async () => {
            if (fails) {
                pending.reject(new Error('Alert request failed'));
            } else {
                pending.resolve(alertResult('7d'));
            }
        });
        expect(selected).not.toHaveAttribute('aria-disabled', 'true');
        expect(selected).toHaveFocus();
    });

    it('does not restore period focus if the user moves elsewhere during loading', async () => {
        const { user, controls } = await showAlerts();
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockReturnValueOnce(pending.promise);
        await user.click(controls.getByRole('button', { name: '7d' }));
        const destination = screen.getByRole('tab', { name: 'Monitoring' });
        await user.click(destination);
        queries.announce.mockClear();
        await act(async () => pending.resolve(alertResult('7d')));
        expect(destination).toHaveFocus();
        expect(queries.announce).not.toHaveBeenCalled();
    });
});

describe('alert monitor condition and active health', () => {
    type AlertFilter = { timeRange: AlertTimeRange; monitorCondition: AlertMonitorCondition };

    function result(filter: AlertFilter, severity?: 'Critical' | 'Warning'): AlertsResult {
        return {
            ...filter,
            available: true,
            alerts: severity
                ? [
                      {
                          id: `${filter.monitorCondition}-${filter.timeRange}`,
                          name: `${filter.monitorCondition} ${filter.timeRange} alert`,
                          monitorCondition: filter.monitorCondition,
                          alertState: 'Closed',
                          severity,
                          rawSeverity: severity === 'Critical' ? 'Sev1' : 'Sev2',
                          portalUrl:
                              'https://portal.azure.us/#@tenant/view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId/encoded/invokedFrom/CopyLinkFeature',
                      },
                  ]
                : [],
            criticalCount: severity === 'Critical' ? 1 : 0,
            warningCount: severity === 'Warning' ? 1 : 0,
            generatedAt: 0,
        };
    }

    const activeFilter: AlertFilter = { timeRange: '1d', monitorCondition: 'Fired' };
    const resolvedFilter: AlertFilter = { timeRange: '1d', monitorCondition: 'Resolved' };

    async function showAlerts() {
        initialTarget = 'advisories';
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        const refresh = await screen.findByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        return {
            user,
            refresh,
            modes: within(screen.getByRole('toolbar', { name: 'Alert monitor condition' })),
            windows: within(screen.getByRole('toolbar', { name: 'Alert time range' })),
        };
    }

    it('shows out-of-window Fired counts and health without changing the filtered list', async () => {
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        queries.activeAlerts.mockResolvedValue({ ...activeAlertSummary('Critical'), totalCount: 3, warningCount: 1 });
        const { user, modes, windows } = await showAlerts();
        expect(screen.getByText('Account health: Critical')).toBeInTheDocument();
        expect(screen.getByText('No active alerts in the selected window.')).toBeVisible();
        expect(screen.getByText(/Active alerts for this account: 3 \(1 critical, 1 warning\)/)).toBeVisible();
        expect(screen.getByText(/Older active alerts may be outside the selected list period/)).toBeVisible();
        await user.click(windows.getByRole('button', { name: '7d' }));
        await user.click(modes.getByRole('button', { name: 'Resolved' }));
        expect(screen.getByText('No resolved alerts in the selected window.')).toBeVisible();
        expect(screen.getByText('Account health: Critical')).toBeInTheDocument();
        expect(queries.activeAlerts).toHaveBeenCalledExactlyOnceWith();
    });

    it('opens the general portal alerts page by keyboard even when both alert queries fail', async () => {
        queries.activeAlerts.mockResolvedValue({ ...activeAlertSummary(), available: false, reason: 'rbac' });
        queries.alerts.mockImplementation(async (filter: AlertFilter) => ({
            ...result(filter),
            available: false,
            reason: 'rbac',
        }));
        const { user } = await showAlerts();
        const link = screen.getByRole('link', { name: 'Open alerts in Azure portal' });
        expect(link).toHaveTextContent('Open alerts in Azure portal');
        expect(link).toHaveAccessibleName('Open alerts in Azure portal');
        expect(link).toHaveAccessibleDescription(
            'Opens Azure Monitor alerts for this account. The portal has its own time and condition filters.',
        );
        expect(link).toHaveAttribute('href', summary.alertsPortalUrl);
        expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        act(() => link.focus());
        await user.keyboard('{Enter}');
        expect(queries.openUrl).toHaveBeenCalledExactlyOnceWith({ url: summary.alertsPortalUrl });
        expect(link).toHaveFocus();
    });

    it('ignores stale Resource Graph results after a newer check', async () => {
        const stale = Promise.withResolvers<ActiveAlertSummary>();
        queries.activeAlerts.mockReturnValueOnce(stale.promise);
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        render(<OverviewDashboard requestedTarget="advisories" onAccountDeleted={vi.fn()} />, {
            wrapper: Wrapper,
            reactStrictMode: true,
        });
        const refresh = await screen.findByRole('button', { name: 'Refresh' });
        await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
        expect(queries.activeAlerts).toHaveBeenCalledTimes(2);
        await act(async () => stale.resolve(activeAlertSummary('Critical')));
        expect(screen.getByText('Account health: Healthy')).toBeInTheDocument();
        expect(screen.getByText(/Active alerts for this account: 0/)).toBeVisible();
    });

    it('provides a keyboard-accessible structured health checklist without declaring missing data passed', async () => {
        queries.accountHealth.mockResolvedValue({
            available: true,
            health: 'Healthy',
            hasSustainedThrottling: false,
            generatedAt: 0,
        });
        const { user, refresh } = await showAlerts();
        const badge = screen.getByLabelText('Healthy', { selector: `.${badgeClassNames.root}` });
        expect(badge).toHaveTextContent('Healthy');
        expect(badge).toHaveAccessibleName('Healthy');
        expect(badge).toHaveAccessibleDescription(/Resource provisioning — Passed/);
        expect(badge).toHaveAccessibleDescription(/Container throttling — Not assessed/);
        expect(badge).toHaveAccessibleDescription(/Active Azure Monitor alerts — Passed/);
        expect(badge).toHaveAttribute('tabindex', '0');
        act(() => refresh.focus());
        await user.tab();
        expect(badge).toHaveFocus();
        const tooltip = await screen.findByRole('tooltip');
        const checks = within(tooltip).getAllByRole('listitem');
        expect(checks).toHaveLength(5);
        expect(checks[0]).toHaveTextContent('Resource provisioning — Passed');
        expect(checks[2]).toHaveTextContent('Container throttling — Not assessed');
        expect(tooltip).toHaveTextContent(
            'HTTP 5xx errors, availability, latency, storage limits, and index health are not assessed',
        );
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        expect(badge).toHaveFocus();
    });

    it('defaults to Active, combines both conditions with every window and exposes no incident workflow', async () => {
        const { user, modes, windows } = await showAlerts();
        expect(queries.alerts).toHaveBeenCalledExactlyOnceWith(activeFilter);
        expect(modes.getAllByRole('button')).toHaveLength(2);
        expect(modes.getByRole('button', { pressed: true })).toHaveAccessibleName('Active');
        expect(screen.getByText('No active alerts in the selected window.')).toBeVisible();
        expect(screen.queryByRole('button', { name: /^(All|New|Acknowledged|Closed)$/ })).toBeNull();
        for (const [label, monitorCondition] of [
            ['Resolved', 'Resolved'],
            ['Active', 'Fired'],
        ] as const) {
            await user.click(modes.getByRole('button', { name: label }));
            for (const timeRange of ['1h', '1d', '7d', '30d'] as const) {
                queries.alerts.mockClear();
                await user.click(windows.getByRole('button', { name: timeRange }));
                expect(queries.alerts).toHaveBeenLastCalledWith({ timeRange, monitorCondition });
                expect(queries.alerts).toHaveBeenCalledTimes(1);
                expect(queries.activeAlerts).toHaveBeenCalledExactlyOnceWith();
                expect(screen.getByText(`No ${label.toLowerCase()} alerts in the selected window.`)).toBeVisible();
            }
            const count = queries.alerts.mock.calls.length;
            await user.click(modes.getByRole('button', { name: label }));
            expect(queries.alerts).toHaveBeenCalledTimes(count);
        }
    });

    it.each(['empty', 'rbac', 'rejected'] as const)(
        'shows resolved loading and %s feedback, preserving keyboard focus',
        async (outcome) => {
            queries.alerts.mockImplementation(async (filter: AlertFilter) => result(filter, 'Warning'));
            queries.activeAlerts.mockResolvedValue(activeAlertSummary('Warning'));
            const { user, modes, windows } = await showAlerts();
            const pending = Promise.withResolvers<AlertsResult>();
            queries.alerts.mockImplementation((filter: AlertFilter) =>
                filter.monitorCondition === 'Resolved' ? pending.promise : Promise.resolve(result(filter, 'Warning')),
            );
            queries.announce.mockClear();
            modes.getByRole('button', { name: 'Active' }).focus();
            await user.keyboard('{ArrowRight}{Enter}');
            const selected = modes.getByRole('button', { name: 'Resolved' });
            expect(selected).toHaveFocus();
            expect(selected).toHaveTextContent('Resolved');
            expect(selected).toHaveAccessibleName('Resolved');
            expect(screen.getByText('Loading resolved alerts…')).toBeVisible();
            expect(screen.queryByText('Fired 1d alert')).toBeNull();
            for (const button of [...modes.getAllByRole('button'), ...windows.getAllByRole('button')]) {
                expect(button).toHaveAttribute('aria-disabled', 'true');
                fireEvent.click(button);
            }
            await user.keyboard(' ');
            expect(queries.alerts).toHaveBeenCalledTimes(2);
            await act(async () => {
                if (outcome === 'rejected') {
                    pending.reject(new Error('Transport failed'));
                } else {
                    pending.resolve({
                        ...result(resolvedFilter),
                        available: outcome === 'empty',
                        reason: outcome === 'rbac' ? 'rbac' : undefined,
                    });
                }
            });
            expect(selected).toHaveFocus();
            expect(selected).not.toHaveAttribute('aria-disabled', 'true');
            expect(screen.queryByText('Loading resolved alerts…')).toBeNull();
            expect(queries.announce).toHaveBeenCalledExactlyOnceWith(
                outcome === 'empty'
                    ? 'Resolved alerts in the selected window: 0'
                    : 'Resolved alerts could not be loaded for the selected window.',
                { polite: true },
            );
            expect(screen.queryAllByText('No resolved alerts in the selected window.')).toHaveLength(
                outcome === 'empty' ? 1 : 0,
            );
            expect(screen.getByText('Account health: Needs Attention')).toBeInTheDocument();
        },
    );

    it.each([
        [undefined, 'Healthy'],
        ['Warning', 'Needs Attention'],
        ['Critical', 'Critical'],
    ] as const)(
        'keeps health at %s signals while loading and viewing historical Critical alerts',
        async (severity, health) => {
            queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
            queries.alerts.mockImplementation(async (filter: AlertFilter) => result(filter, severity));
            queries.activeAlerts.mockResolvedValue(activeAlertSummary(severity));
            const { user, modes } = await showAlerts();
            const pending = Promise.withResolvers<AlertsResult>();
            queries.alerts.mockImplementation((filter: AlertFilter) =>
                filter.monitorCondition === 'Resolved' ? pending.promise : Promise.resolve(result(filter, severity)),
            );
            await user.click(modes.getByRole('button', { name: 'Resolved' }));
            expect(screen.getByText(`Account health: ${health}`)).toBeInTheDocument();
            await act(async () => pending.resolve(result(resolvedFilter, 'Critical')));
            expect(screen.getByText('Resolved 1d alert')).toBeVisible();
            expect(screen.getByText(`Account health: ${health}`)).toBeInTheDocument();
            const portal = screen.getByRole('button', { name: 'View in Azure portal' });
            expect(portal).toHaveAccessibleDescription('View alert Resolved 1d alert in the Azure portal');
            await user.click(portal);
            expect(queries.openUrl).toHaveBeenCalledExactlyOnceWith({
                url: result(resolvedFilter, 'Critical').alerts[0].portalUrl,
            });
            expect(screen.queryByText('Closed')).toBeNull();
        },
    );

    it.each([undefined, 'Critical'] as const)(
        'retains known %s signals on active failure and only clears them on successful Refresh',
        async (severity) => {
            queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
            queries.alerts.mockImplementation(async (filter: AlertFilter) => result(filter, severity));
            queries.activeAlerts.mockResolvedValue(activeAlertSummary(severity));
            const { user, modes, refresh, windows } = await showAlerts();
            await user.click(modes.getByRole('button', { name: 'Resolved' }));
            await user.click(windows.getByRole('button', { name: '7d' }));
            const pending = Promise.withResolvers<ActiveAlertSummary>();
            queries.alerts.mockClear();
            queries.activeAlerts.mockReturnValueOnce(pending.promise);
            queries.alerts.mockImplementation(async (filter: AlertFilter) => result(filter, 'Critical'));
            await user.click(refresh);
            expect(queries.alerts.mock.calls).toEqual([[{ timeRange: '7d', monitorCondition: 'Resolved' }]]);
            expect(screen.getByText(`Account health: ${severity ?? 'Healthy'}`)).toBeInTheDocument();
            expect(refresh).toHaveAttribute('aria-busy', 'true');
            await act(async () => pending.reject(new Error('Cannot check active alerts')));
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(screen.getByText('Resolved 7d alert')).toBeVisible();
            expect(screen.getByText(`Account health: ${severity ?? 'Unknown'}`)).toBeInTheDocument();
            queries.alerts.mockImplementation(async (filter: AlertFilter) =>
                result(filter, filter.monitorCondition === 'Resolved' ? 'Critical' : undefined),
            );
            queries.activeAlerts.mockResolvedValue(activeAlertSummary());
            await user.click(refresh);
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(screen.getByText('Account health: Healthy')).toBeInTheDocument();
            expect(screen.getByText('Resolved 7d alert')).toBeVisible();
        },
    );

    it('does not claim Healthy when the initial active query is unavailable', async () => {
        queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
        queries.activeAlerts.mockResolvedValue({
            ...activeAlertSummary(),
            available: false,
            reason: 'rbac',
        });
        await showAlerts();
        expect(screen.getByText('Account health: Unknown')).toBeInTheDocument();
        expect(screen.queryByText('Account health: Healthy')).toBeNull();
    });

    it.each([false, true])(
        'ignores a stale initial response after condition/window changes and during Refresh (reject: %s)',
        async (reject) => {
            const user = userEvent.setup();
            const stale = Promise.withResolvers<AlertsResult>();
            queries.alerts.mockReturnValueOnce(stale.promise);
            queries.accountHealth.mockResolvedValue({ available: true, health: 'Healthy', generatedAt: 0 });
            render(<OverviewDashboard requestedTarget="advisories" onAccountDeleted={vi.fn()} />, {
                wrapper: Wrapper,
                reactStrictMode: true,
            });
            const refresh = await screen.findByRole('button', { name: 'Refresh' });
            await waitFor(() => expect(refresh).not.toHaveAttribute('aria-disabled', 'true'));
            expect(queries.alerts).toHaveBeenCalledTimes(2);
            const modes = within(screen.getByRole('toolbar', { name: 'Alert monitor condition' }));
            await user.click(modes.getByRole('button', { name: 'Resolved' }));
            await user.click(
                within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', { name: '7d' }),
            );
            const latest = Promise.withResolvers<AlertsResult>();
            queries.alerts.mockImplementation((filter: AlertFilter) =>
                filter.monitorCondition === 'Resolved' ? latest.promise : Promise.resolve(result(filter)),
            );
            await user.click(refresh);
            await act(async () => {
                if (reject) {
                    stale.reject(new Error('Stale failure'));
                } else {
                    stale.resolve(result(activeFilter, 'Critical'));
                }
            });
            expect(screen.getByText('Account health: Healthy')).toBeInTheDocument();
            expect(screen.queryByText('Fired 1d alert')).toBeNull();
            expect(modes.getByRole('button', { name: 'Resolved' })).toHaveAttribute('aria-disabled', 'true');
            expect(screen.getByText('Loading resolved alerts…')).toBeVisible();
            expect(screen.queryByRole('group', { name: 'Error' })).toBeNull();
            await act(async () =>
                latest.resolve(result({ timeRange: '7d', monitorCondition: 'Resolved' }, 'Critical')),
            );
            await waitFor(() => expect(refresh).toHaveAttribute('aria-busy', 'false'));
            expect(screen.getByText('Resolved 7d alert')).toBeVisible();
            expect(screen.getByText('Account health: Healthy')).toBeInTheDocument();
        },
    );

    it('does not announce a resolved result from a hidden tab or replay it on return', async () => {
        const { user, modes } = await showAlerts();
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockImplementation((filter: AlertFilter) =>
            filter.monitorCondition === 'Resolved' ? pending.promise : Promise.resolve(result(filter)),
        );
        await user.click(modes.getByRole('button', { name: 'Resolved' }));
        await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
        queries.announce.mockClear();
        await act(async () => pending.resolve(result(resolvedFilter)));
        expect(queries.announce).not.toHaveBeenCalled();
        await user.click(screen.getByRole('tab', { name: 'Advisories' }));
        expect(queries.announce).not.toHaveBeenCalled();
        expect(screen.getByText('No resolved alerts in the selected window.')).toBeVisible();
    });
});

describe('inventory accessibility', () => {
    const manyRows = Array.from({ length: 53 }, (_, index) => ({
        ...rows[0],
        containerId: `container-${String(index).padStart(3, '0')}`,
    }));
    const inventoryProps = {
        supported: true,
        available: true,
        onRevealInTree: vi.fn(),
        onOpenQueryEditor: vi.fn(),
        onSelectContainer: vi.fn(),
    };

    it('pins Critical rows before pagination for every column and direction without discarding filters', async () => {
        const user = userEvent.setup();
        const metrics = Object.fromEntries(
            manyRows.map((row, index) => [
                `${row.databaseId}/${row.containerId}`,
                {
                    databaseId: row.databaseId,
                    containerId: row.containerId,
                    throttled: index >= 50,
                    health: index >= 50 ? 'Critical' : index === 0 ? 'Needs Attention' : 'Healthy',
                    storage: {
                        data: { status: 'unavailable', reason: 'noData' },
                        index: { status: 'unavailable', reason: 'noData' },
                    },
                } satisfies ContainerMetrics,
            ]),
        );
        render(<InventoryTable {...inventoryProps} rows={manyRows} metrics={metrics} />, { wrapper: Wrapper });
        const table = screen.getByRole('table', { name: 'Containers' });
        const expectCriticalFirst = () => {
            const visible = within(table).getAllByRole('row').slice(1);
            expect(visible).toHaveLength(25);
            visible.slice(0, 3).forEach((row) => expect(within(row).getByText('Critical')).toBeVisible());
            visible.slice(3).forEach((row) => expect(within(row).queryByText('Critical')).toBeNull());
        };
        expectCriticalFirst();
        for (const name of [
            'Container',
            'Database',
            'Throughput',
            'Storage',
            'Documents',
            'Peak normalized RU',
            'Throttling',
        ]) {
            const sort = within(screen.getByRole('columnheader', { name })).getByRole('button');
            await user.click(sort);
            expectCriticalFirst();
            await user.click(sort);
            expectCriticalFirst();
        }
        const search = screen.getByRole('textbox', { name: 'Search containers or databases' });
        await user.type(search, 'container-000');
        expect(within(table).getAllByRole('row')).toHaveLength(2);
        expect(within(table).queryByText('Critical')).toBeNull();
    });

    it('shows partial storage and exposes component reasons on keyboard focus', async () => {
        const user = userEvent.setup();
        const row = rows[0];
        render(
            <InventoryTable
                {...inventoryProps}
                rows={[row]}
                metrics={{
                    [`${row.databaseId}/${row.containerId}`]: {
                        databaseId: row.databaseId,
                        containerId: row.containerId,
                        throttled: false,
                        storage: {
                            data: { status: 'available', bytes: 1024 ** 3, timestamp: 1000 },
                            index: { status: 'unavailable', reason: 'rbac' },
                        },
                        storageGrowthBytes: 1024 ** 2,
                    },
                }}
            />,
            { wrapper: Wrapper },
        );
        const label = screen.getByText('1 GB · Partial data');
        expect(label).toBeVisible();
        expect(screen.getByText('Data growth: +1 MB / 7 days')).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'orders: show partition health in database' }));
        await user.tab();
        expect(label).toHaveFocus();
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Data: 1 GB; indexes: No permission.');
        expect(label).toHaveAccessibleDescription('Data: 1 GB; indexes: No permission.');
        expect(label).not.toHaveAttribute('aria-label');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        expect(label).toHaveFocus();
    });

    it('preserves storage failure reasons for rows missing from every metric response', async () => {
        const user = userEvent.setup();
        render(
            <InventoryTable
                {...inventoryProps}
                rows={[rows[0]]}
                metrics={{}}
                storageFallback={{
                    data: { status: 'unavailable', reason: 'rbac' },
                    index: { status: 'unavailable', reason: 'error' },
                }}
            />,
            { wrapper: Wrapper },
        );
        await user.click(screen.getByRole('button', { name: 'orders: show partition health in database' }));
        await user.tab();
        expect(document.activeElement).toHaveTextContent('—');
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Data: No permission; indexes: Unable to load.');
        expect(document.activeElement).toHaveAccessibleDescription('Data: No permission; indexes: Unable to load.');
    });

    it('omits Serverless throughput controls and cells from keyboard and table navigation', async () => {
        const user = userEvent.setup();
        render(
            <InventoryTable
                {...inventoryProps}
                rows={[rows[0]]}
                normalizedRuApplicability={getAccountMetricApplicability(true).normalizedRu}
            />,
            { wrapper: Wrapper },
        );
        expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /throughput mode/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Throughput' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Peak normalized RU' })).not.toBeInTheDocument();
        const tableRows = within(screen.getByRole('table')).getAllByRole('row');
        expect(within(tableRows[0]).getAllByRole('columnheader')).toHaveLength(8);
        expect(within(tableRows[1]).getAllByRole('cell')).toHaveLength(8);
        await user.click(screen.getByRole('button', { name: 'orders: show partition health in database' }));
        await user.tab();
        const badge = within(tableRows[1]).getByLabelText('Unknown');
        expect(badge).toHaveFocus();
        expect(badge).toHaveAccessibleName('Unknown');
        expect(badge).toHaveAccessibleDescription(/Uses container request observations, not normalized RU/);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Reveal in tree' })).toHaveFocus();
    });

    it('caps the viewport at the header and five measured rows, and shrinks with filtered results', async () => {
        let rowHeight = 40;
        vi.spyOn(HTMLTableRowElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLTableRowElement,
        ) {
            return DOMRect.fromRect({ height: this.rowIndex === 0 ? 32 : rowHeight + this.rowIndex * 2 });
        });
        let resizeRows = () => {};
        const disconnect = vi.fn();
        vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback: ResizeObserverCallback) {
            const observer: ResizeObserver = {
                observe(target: Element) {
                    if (target instanceof HTMLTableRowElement) {
                        resizeRows = () => callback([], observer);
                    }
                },
                unobserve() {},
                disconnect,
            };
            return observer;
        });
        const user = userEvent.setup();
        const { unmount } = render(<InventoryTable {...inventoryProps} rows={manyRows} />, { wrapper: Wrapper });
        const table = screen.getByRole('table', { name: 'Containers' });
        const viewport = table.parentElement;
        expect(viewport).toHaveStyle({ maxHeight: '262px' });
        expect(within(table).getAllByRole('row')).toHaveLength(26);

        rowHeight = 60;
        act(resizeRows);
        expect(viewport).toHaveStyle({ maxHeight: '362px' });
        const search = screen.getByRole('textbox', { name: 'Search containers or databases' });
        await user.type(search, 'container-000');
        expect(viewport?.style.maxHeight).toBe('');
        expect(within(table).getAllByRole('row')).toHaveLength(2);
        expect(search).toHaveFocus();
        await user.clear(search);
        expect(viewport).toHaveStyle({ maxHeight: '362px' });
        unmount();
        expect(disconnect).toHaveBeenCalled();
    });

    it('pages a native table with total row count, logical row positions and stable boundary controls', async () => {
        const user = userEvent.setup();
        render(<InventoryTable {...inventoryProps} rows={manyRows} />, { wrapper: Wrapper });
        const table = screen.getByRole('table', { name: 'Containers' });
        const next = screen.getByRole('button', { name: 'Next page' });
        const previous = screen.getByRole('button', { name: 'Previous page' });
        expect(table).toHaveAttribute('aria-rowcount', '54');
        expect(within(table).getAllByRole('row')).toHaveLength(26);
        expect(within(table).getAllByRole('row')[0]).toHaveAttribute('aria-rowindex', '1');
        expect(within(table).getAllByRole('row')[1]).toHaveAttribute('aria-rowindex', '2');
        expect(previous).toHaveAttribute('aria-disabled', 'true');
        next.focus();
        await user.keyboard('{Enter}');
        expect(next).toHaveFocus();
        expect(within(table).getAllByRole('row')[1]).toHaveAttribute('aria-rowindex', '27');
        expect(screen.getByText('Page 2 of 3. Containers 26 to 50 of 53.')).toBeVisible();
        expect(queries.announce).toHaveBeenLastCalledWith('Page 2 of 3. Containers 26 to 50 of 53.', { polite: true });
        await user.keyboard(' ');
        expect(next).toHaveFocus();
        expect(next).toHaveAttribute('aria-disabled', 'true');
        expect(next).not.toBeDisabled();
        expect(within(table).getAllByRole('row')).toHaveLength(4);
        expect(within(table).getAllByRole('row')[3]).toHaveAttribute('aria-rowindex', '54');
        await user.keyboard('{Enter} ');
        expect(screen.getByText('Page 3 of 3. Containers 51 to 53 of 53.')).toBeVisible();
        await user.click(previous);
        expect(previous).toHaveFocus();
        expect(screen.getByText('Page 2 of 3. Containers 26 to 50 of 53.')).toBeVisible();
    });

    it('sorts and filters the entire inventory, resets the page, and retains selection outside the page', async () => {
        const user = userEvent.setup();
        render(<InventoryTable {...inventoryProps} rows={manyRows} selectedContainer={manyRows[52]} />, {
            wrapper: Wrapper,
        });
        await user.click(screen.getByRole('button', { name: 'Next page' }));
        const sort = within(screen.getByRole('columnheader', { name: 'Container' })).getByRole('button');
        await user.click(sort);
        expect(sort).toHaveFocus();
        expect(screen.getByText('Page 1 of 3. Containers 1 to 25 of 53.')).toBeVisible();
        const selected = screen.getByRole('button', { name: 'container-052: show partition health in database' });
        expect(selected).toHaveAttribute('aria-pressed', 'true');
        expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toContainElement(selected);
        const search = screen.getByRole('textbox', { name: 'Search containers or databases' });
        await user.type(search, 'container-000');
        expect(search).toHaveFocus();
        expect(screen.getByText('Page 1 of 1. Containers 1 to 1 of 1.')).toBeVisible();
        expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '2');
        expect(screen.getByRole('button', { name: 'container-000: show partition health in database' })).toBeVisible();
    });

    it('recovers focus when a refreshed row disappears and clamps a shortened page', async () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const user = userEvent.setup();
        const { rerender } = render(<InventoryTable {...inventoryProps} rows={manyRows} />, { wrapper: Wrapper });
        await user.click(screen.getByRole('button', { name: 'Next page' }));
        await user.click(screen.getByRole('button', { name: 'Next page' }));
        screen.getByRole('button', { name: 'container-052: show partition health in database' }).focus();
        rerender(<InventoryTable {...inventoryProps} rows={manyRows.slice(0, 26)} />);
        expect(screen.getByRole('region', { name: 'Container inventory' })).toHaveFocus();
        expect(screen.getByText('Page 2 of 2. Containers 26 to 26 of 26.')).toBeVisible();
        const previous = screen.getByRole('button', { name: 'Previous page' });
        previous.focus();
        rerender(<InventoryTable {...inventoryProps} rows={manyRows.slice(0, 25)} />);
        expect(previous).toHaveFocus();
        expect(previous).toHaveAttribute('aria-disabled', 'true');
        screen.getByRole('button', { name: 'container-000: show partition health in database' }).focus();
        rerender(<InventoryTable {...inventoryProps} rows={[]} />);
        expect(screen.getByRole('region', { name: 'Container inventory' })).toHaveFocus();
    });

    it('does not take focus back when refreshed rows disappear on a hidden tab', () => {
        vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const { rerender } = render(<InventoryTable {...inventoryProps} rows={manyRows} />, { wrapper: Wrapper });
        screen.getByRole('button', { name: 'container-000: show partition health in database' }).focus();
        rerender(<InventoryTable {...inventoryProps} rows={[]} active={false} />);
        expect(screen.getByRole('region', { name: 'Container inventory' })).not.toHaveFocus();
    });

    it('does not recover removed-row focus when the webview no longer owns focus', () => {
        const { rerender } = render(<InventoryTable {...inventoryProps} rows={manyRows} />, { wrapper: Wrapper });
        screen.getByRole('button', { name: 'container-000: show partition health in database' }).focus();
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        rerender(<InventoryTable {...inventoryProps} rows={[]} />);
        expect(screen.getByRole('region', { name: 'Container inventory' })).not.toHaveFocus();
    });

    it('includes the selected filter text and resource context without repeating icon tooltip names', async () => {
        const user = userEvent.setup();
        queries.inventory.mockResolvedValue({
            supported: true,
            available: true,
            rows: [rows[0], { ...rows[0], databaseId: 'other-database' }],
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const database = screen.getByRole('combobox', { name: 'Filter by database: All databases' });
        expect(database).toHaveTextContent('All databases');
        const throughput = screen.getByRole('combobox', { name: 'Filter by throughput mode: All throughput modes' });
        expect(throughput).toHaveTextContent('All throughput modes');
        const selector = screen.getByRole('combobox', { name: /^Select a container for partition health:/ });
        expect(selector).toHaveTextContent('orders · database');
        expect(selector).toHaveAccessibleName('Select a container for partition health: orders · database');
        await user.click(selector);
        await user.click(screen.getByRole('option', { name: 'orders · other-database' }));
        expect(selector).toHaveTextContent('orders · other-database');
        expect(selector).toHaveAccessibleName('Select a container for partition health: orders · other-database');

        for (const label of ['Reveal in tree', 'Open Query Editor']) {
            const actions = screen.getAllByRole('button', { name: label });
            for (const [index, action] of actions.entries()) {
                const db = index === 0 ? 'database' : 'other-database';
                expect(action).toHaveAccessibleName(label);
                expect(action).toHaveAccessibleDescription(`Container orders in database ${db}`);
                action.focus();
                await user.keyboard('{Enter}');
                expect(label === 'Reveal in tree' ? queries.reveal : queries.queryEditor).toHaveBeenLastCalledWith({
                    databaseId: db,
                    containerId: 'orders',
                });
            }
        }
        await user.click(database);
        await user.click(screen.getByRole('option', { name: 'other-database' }));
        expect(database).toHaveTextContent('other-database');
        expect(database).toHaveAccessibleName('Filter by database: other-database');
        await user.click(throughput);
        await user.click(screen.getByRole('option', { name: 'Dedicated' }));
        expect(throughput).toHaveTextContent('Dedicated');
        expect(throughput).toHaveAccessibleName('Filter by throughput mode: Dedicated');
    });

    it('coalesces filter result announcements and does not announce initial results or sorting', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        expect(queries.announce).not.toHaveBeenCalled();
        const search = screen.getByRole('textbox', { name: 'Search containers or databases' });
        fireEvent.change(search, { target: { value: 'o' } });
        fireEvent.change(search, { target: { value: 'orders' } });
        await waitFor(() =>
            expect(queries.announce).toHaveBeenCalledExactlyOnceWith('Containers matching the current filters: 1', {
                polite: true,
            }),
        );
        queries.announce.mockClear();
        fireEvent.change(search, { target: { value: 'missing' } });
        await waitFor(() =>
            expect(queries.announce).toHaveBeenCalledExactlyOnceWith('No containers match the current filters.', {
                polite: true,
            }),
        );
        queries.announce.mockClear();
        fireEvent.change(search, { target: { value: '' } });
        await waitFor(() =>
            expect(queries.announce).toHaveBeenCalledExactlyOnceWith('Containers matching the current filters: 2', {
                polite: true,
            }),
        );
        queries.announce.mockClear();
        await user.click(within(screen.getByRole('columnheader', { name: 'Container' })).getByRole('button'));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
        expect(queries.announce).not.toHaveBeenCalled();
    });

    it('cancels a pending filter announcement when leaving the inventory tab', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Search containers or databases' }), {
            target: { value: 'missing' },
        });
        await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
        expect(queries.announce).not.toHaveBeenCalled();
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
        expect(queries.announce).not.toHaveBeenCalled();
    });

    it('exposes only sortable headers as buttons and sorts with Enter and Space', async () => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
        const table = screen.getByRole('table', { name: 'Containers' });
        for (const name of [
            'Container',
            'Database',
            'Throughput',
            'Storage',
            'Documents',
            'Peak normalized RU',
            'Throttling',
        ]) {
            const header = within(table).getByRole('columnheader', { name });
            const button = within(header).getByRole('button', { name });
            expect(button).toHaveTextContent(name);
            expect(button).toHaveAccessibleName(name);
            expect(button.tabIndex).toBe(0);
        }
        for (const name of ['Partition key', 'Indexing', 'Actions']) {
            expect(within(within(table).getByRole('columnheader', { name })).queryByRole('button')).toBeNull();
        }
        const header = within(table).getByRole('columnheader', { name: 'Container' });
        const button = within(header).getByRole('button', { name: 'Container' });
        const containerNames = () =>
            within(table)
                .getAllByRole('button', { name: /: show partition health/ })
                .map((element) => element.textContent);
        expect(header).toHaveAttribute('aria-sort', 'ascending');
        expect(containerNames()).toEqual(['orders', 'products']);
        button.focus();
        await user.keyboard('{Enter}');
        expect(header).toHaveAttribute('aria-sort', 'descending');
        expect(containerNames()).toEqual(['products', 'orders']);
        expect(button).toHaveFocus();
        await user.keyboard(' ');
        expect(header).toHaveAttribute('aria-sort', 'ascending');
        expect(containerNames()).toEqual(['orders', 'products']);
        expect(button).toHaveFocus();
    });

    it.each(['ru', 'storage'] as const)(
        'uses the same %s precision in heatmap names, values and explanations',
        async (mode) => {
            const user = userEvent.setup();
            const shares = [0.4, 4.6, 9.94, 10.4, 95.6];
            const formatted = ['0.4', '4.6', '9.9', '10', '96'];
            queries.partition.mockResolvedValue({
                available: true,
                mode,
                databaseId: 'database',
                containerId: 'orders',
                tiles: shares.map((sharePercent, index) => ({
                    partitionId: String(index),
                    sharePercent,
                    level: 1,
                    hot: index === 4,
                })),
                skewScore: 0,
                topPartitionShare: 95.6,
                partitionCount: shares.length,
                topN: shares.length,
                generatedAt: 0,
            } satisfies PartitionHealthResult);
            render(<AccountOverview />, { wrapper: Wrapper });
            await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
            for (const [index, percent] of formatted.entries()) {
                const name = `Physical partition PKR-${index}, ${percent} percent ${mode === 'ru' ? 'p99 utilization' : 'of storage'}${index === 4 ? ', flagged as hot' : ''}`;
                const tile = screen.getByTitle(
                    `PKR-${index}: ${percent}% ${mode === 'ru' ? 'p99 utilization' : 'share'}`,
                );
                expect(tile).toHaveRole('figure');
                expect(tile).toHaveAccessibleName(name);
                expect(tile.querySelector('figcaption')).toBeNull();
                expect(within(tile).getByText(`${percent}%`)).toBeVisible();
            }
            expect(
                screen.getByText(mode === 'ru' ? 'Ran at 0.4% p99 utilization.' : 'Holds 0.4% of container storage.'),
            ).toBeVisible();
        },
    );
});

describe('local result announcements', () => {
    it.each([false, true])(
        'announces one alert-window result without claiming success on failure (%s)',
        async (fails) => {
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            await user.click(await screen.findByRole('tab', { name: 'Advisories' }));
            const windowButton = within(screen.getByRole('toolbar', { name: 'Alert time range' })).getByRole('button', {
                name: '7d',
            });
            await waitFor(() => expect(windowButton).not.toHaveAttribute('aria-disabled', 'true'));
            queries.announce.mockClear();
            const pending = Promise.withResolvers<AlertsResult>();
            queries.alerts.mockReturnValueOnce(pending.promise);
            await user.click(windowButton);
            expect(queries.announce).not.toHaveBeenCalled();
            await act(async () => {
                if (fails) {
                    pending.reject(new Error('Failed'));
                } else {
                    pending.resolve({
                        available: true,
                        timeRange: '7d',
                        monitorCondition: 'Fired',
                        alerts: [],
                        criticalCount: 0,
                        warningCount: 0,
                        generatedAt: 1,
                    });
                }
            });
            expect(queries.announce).toHaveBeenCalledExactlyOnceWith(
                fails
                    ? 'Active alerts could not be loaded for the selected window.'
                    : 'Active alerts in the selected window: 0',
                { polite: true },
            );
        },
    );
});

describe('Advisor recommendation accessibility', () => {
    it('describes each Learn more action with its visible recommendation and opens the matching URL', async () => {
        const user = userEvent.setup();
        const recommendations: RecommendationsResult['recommendations'] = [
            {
                id: 'cost',
                category: 'Cost',
                impact: 'High',
                problem: 'Review provisioned capacity',
                learnMoreLink: 'https://example.invalid/capacity',
            },
            {
                id: 'performance',
                category: 'Performance',
                impact: 'Medium',
                problem: 'Review indexing policy',
                learnMoreLink: 'https://example.invalid/indexing',
            },
            { id: 'no-link', category: 'Cost', impact: 'Low', problem: 'Recommendation without documentation' },
        ];
        queries.recommendations.mockResolvedValue({
            available: true,
            recommendations,
            hasHighImpactPerfCost: true,
            generatedAt: 0,
        } satisfies RecommendationsResult);
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Advisories' }));
        const actions = screen.getAllByRole('button', { name: 'Learn more' });
        expect(actions).toHaveLength(2);
        for (const [index, action] of actions.entries()) {
            const recommendation = recommendations[index];
            const problem = screen.getByText(recommendation.problem);
            expect(problem).toBeVisible();
            expect(action).toHaveTextContent('Learn more');
            expect(action).toHaveAccessibleName('Learn more');
            expect(action).toHaveAccessibleDescription(recommendation.problem);
            expect(action).toHaveAttribute('aria-describedby', problem.id);
            action.focus();
            await user.keyboard('{Enter}');
            expect(queries.openUrl).toHaveBeenNthCalledWith(index + 1, { url: recommendation.learnMoreLink });
        }
        expect(queries.openUrl).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Recommendation without documentation')).toBeVisible();
    });
});

describe('native auxiliary action errors', () => {
    it.each([
        ['revealInTree', 'Reveal in tree', queries.reveal],
        ['openQueryEditor', 'Open Query Editor', queries.queryEditor],
    ] as const)(
        'shows one native error for %s without rethrowing or an inline duplicate',
        async (action, label, query) => {
            const user = userEvent.setup();
            const error = new Error('Action failed');
            query.mockImplementation(async () => {
                rpcEvents.emitError(error, { id: 1, type: 'mutation', path: `accountOverview.${action}` });
                throw error;
            });
            render(<AccountOverview />, { wrapper: Wrapper });
            await user.click(await screen.findByRole('tab', { name: 'Databases and Containers' }));
            await user.click(screen.getAllByRole('button', { name: label })[0]);
            expect(queries.showErrorMessage).toHaveBeenCalledExactlyOnceWith({ message: error.message });
            expect(screen.queryByRole('group', { name: 'Error' })).not.toBeInTheDocument();
        },
    );

    it.each(['openUrl', 'showOutput'] as const)(
        'notifies once for %s through the RPC error channel',
        async (action) => {
            const { unmount } = render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            const error = new Error('Action failed');
            act(() => rpcEvents.emitError(error, { id: 1, type: 'mutation', path: `accountOverview.${action}` }));
            expect(queries.showErrorMessage).toHaveBeenCalledExactlyOnceWith({ message: error.message });
            unmount();
            rpcEvents.emitError(error, { id: 2, type: 'mutation', path: `accountOverview.${action}` });
            expect(queries.showErrorMessage).toHaveBeenCalledTimes(1);
        },
    );

    it('does not notify for cancelled calls, data queries, telemetry or notification failures', async () => {
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        const error = new Error('Failed');
        act(() => {
            rpcEvents.emitAborted({ id: 1, type: 'mutation', path: 'accountOverview.openUrl' });
            rpcEvents.emitError(error, { id: 2, type: 'query', path: 'accountOverview.getAlerts' });
            rpcEvents.emitError(error, { id: 3, type: 'mutation', path: 'accountOverview.reportEvent' });
            rpcEvents.emitError(error, { id: 4, type: 'mutation', path: 'accountOverview.showErrorMessage' });
        });
        expect(queries.showErrorMessage).not.toHaveBeenCalled();
    });

    it('logs a failed notification without recursively notifying or rethrowing', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const notificationError = new Error('Notification transport failed');
        queries.showErrorMessage.mockRejectedValueOnce(notificationError);
        render(<AccountOverview />, { wrapper: Wrapper });
        await screen.findByRole('tab', { name: 'Monitoring' });
        act(() =>
            rpcEvents.emitError(new Error('Open failed'), {
                id: 1,
                type: 'mutation',
                path: 'accountOverview.openUrl',
            }),
        );
        await waitFor(() =>
            expect(log).toHaveBeenCalledWith('Unable to display Account Overview action error.', notificationError),
        );
        expect(queries.showErrorMessage).toHaveBeenCalledTimes(1);
    });
});

describe('tabbed Account Overview', () => {
    it('keeps a dialog and focus during background completion or replay of the same navigation revision', async () => {
        const user = userEvent.setup();
        initialTarget = 'advisories';
        const pending = Promise.withResolvers<AlertsResult>();
        queries.alerts.mockReturnValueOnce(pending.promise);
        queries.advisories.mockResolvedValue({
            available: true,
            generatedAt: 0,
            advisories: [
                {
                    id: 'idle',
                    rule: 'IdleContainer',
                    severity: 'Low',
                    scope: 'database/orders',
                    title: 'Idle container',
                    rationale: 'Low traffic.',
                    suggestedAction: 'Review capacity.',
                    thresholdReference: 'Below threshold.',
                },
            ],
        });
        render(<AccountOverview />, { wrapper: Wrapper });
        const card = await screen.findByRole('button', { name: /^Idle containers/ });
        await user.click(card);
        const close = screen.getByRole('button', { name: 'Close' });
        close.focus();
        await act(async () =>
            pending.resolve({
                available: true,
                timeRange: '1d',
                monitorCondition: 'Fired',
                alerts: [],
                criticalCount: 0,
                warningCount: 0,
                generatedAt: 1,
            }),
        );
        expect(screen.getByRole('dialog')).toBeVisible();
        expect(close).toHaveFocus();
        navigate('advisories', 0);
        expect(screen.getByRole('dialog')).toBeVisible();
        expect(close).toHaveFocus();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(card).toHaveFocus());
    });

    it.each(['overview', 'advisories', ...METRIC_ORDER] as const)(
        'closes an advisory dialog and focuses the explicit host destination %s',
        async (target) => {
            const user = userEvent.setup();
            initialTarget = 'advisories';
            queries.advisories.mockResolvedValue({
                available: true,
                generatedAt: 0,
                advisories: [
                    {
                        id: 'idle',
                        rule: 'IdleContainer',
                        severity: 'Low',
                        scope: 'database/orders',
                        title: 'Idle container',
                        rationale: 'Low traffic.',
                        suggestedAction: 'Review capacity.',
                        thresholdReference: 'Below threshold.',
                    },
                ],
            });
            render(<AccountOverview />, { wrapper: Wrapper });
            await user.click(await screen.findByRole('button', { name: /^Idle containers/ }));
            expect(screen.getByRole('dialog')).toBeVisible();
            const calls = dataQueryCounts();
            navigate(target, 1);
            expect(screen.queryByRole('dialog')).toBeNull();
            const destination =
                target === 'overview' || target === 'advisories'
                    ? screen.getByRole('tab', { name: target === 'overview' ? 'Monitoring' : 'Advisories' })
                    : screen.getByRole('region', { name: `${METRIC_VIEWS[target].label} trend` });
            await waitFor(() => expect(destination).toHaveFocus());
            expect(dataQueryCounts()).toEqual(calls);
            navigate(target, 2);
            expect(destination).toHaveFocus();
            await user.click(screen.getByRole('tab', { name: 'Advisories' }));
            expect(screen.queryByRole('dialog')).toBeNull();
        },
    );

    it.each([
        ['Monitoring', /^Metric time range:/],
        ['Monitoring', /^Database scope for metrics:/],
        ['Databases and Containers', /^Filter by database:/],
        ['Databases and Containers', /^Filter by throughput mode:/],
        ['Databases and Containers', /^Select a container for partition health:/],
    ] as const)('closes a %s dropdown on explicit navigation (%s)', async (tab, name) => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: tab }));
        const select = screen.getByRole('combobox', { name });
        await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'));
        await user.click(select);
        expect(screen.getByRole('listbox')).toBeVisible();
        const recovery =
            tab === 'Databases and Containers'
                ? vi.spyOn(screen.getByRole('region', { name: 'Container inventory' }), 'focus')
                : vi.fn();
        navigate('advisories', 1);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(recovery).not.toHaveBeenCalled();
        expect(screen.getByRole('tab', { name: 'Advisories' })).toHaveFocus();
    });

    it.each([
        ['Advisories', 'Alert time range', ['1h', '1d', '7d', '30d'], '1d'],
        ['Advisories', 'Alert monitor condition', ['Active', 'Resolved'], 'Active'],
        [
            'Databases and Containers',
            'Partition distribution measure',
            ['By RU Share', 'By Storage Share'],
            'By RU Share',
        ],
    ] as const)('uses a single-selection Fluent toolbar in %s', async (tab, name, labels, initialLabel) => {
        const user = userEvent.setup();
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: tab }));
        const toolbar = screen.getByRole('toolbar', { name });
        const controls = within(toolbar);
        expect(toolbar).toHaveClass(toolbarClassNames.root);
        for (const label of labels) {
            const button = controls.getByRole('button', { name: label });
            expect(button).toHaveClass(toggleButtonClassNames.root);
            expect(button).toHaveTextContent(label);
            expect(button).toHaveAccessibleName(label);
        }
        const first = controls.getByRole('button', { name: labels[0] });
        const second = controls.getByRole('button', { name: labels[1] });
        first.focus();
        await user.keyboard('{ArrowRight}');
        expect(second).toHaveFocus();
        expect(controls.getByRole('button', { pressed: true })).toHaveAccessibleName(initialLabel);
        await user.keyboard(' ');
        expect(controls.getByRole('button', { pressed: true })).toBe(second);
        await user.keyboard('{ArrowLeft}{Enter}');
        expect(controls.getByRole('button', { pressed: true })).toBe(first);
        await user.click(first);
        expect(controls.getByRole('button', { pressed: true })).toBe(first);
        await user.tab();
        expect(toolbar.contains(document.activeElement)).toBe(false);
    });

    it('uses static Fluent badges for alert severity, recommendation impact and hot partitions', async () => {
        const user = userEvent.setup();
        queries.alerts.mockResolvedValue({
            available: true,
            alerts: (['Critical', 'Warning', 'Informational'] as const).map((severity) => ({
                id: severity,
                name: `${severity} alert`,
                severity,
                rawSeverity: 'Sev0',
                portalUrl: 'https://example.invalid/alert',
            })),
            criticalCount: 1,
            warningCount: 1,
            timeRange: '1d',
            monitorCondition: 'Fired',
            generatedAt: 0,
        } satisfies AlertsResult);
        queries.recommendations.mockResolvedValue({
            available: true,
            recommendations: (['High', 'Medium', 'Low'] as const).map((impact) => ({
                id: impact,
                category: 'Cost',
                impact,
                problem: `${impact} recommendation`,
            })),
            hasHighImpactPerfCost: true,
            generatedAt: 0,
        } satisfies RecommendationsResult);
        queries.partition.mockResolvedValue({
            available: true,
            mode: 'ru',
            databaseId: 'database',
            containerId: 'orders',
            tiles: [{ partitionId: 'hot', sharePercent: 95, level: 5, hot: true }],
            skewScore: 95,
            topPartitionShare: 95,
            partitionCount: 1,
            topN: 5,
            generatedAt: 0,
        } satisfies PartitionHealthResult);
        render(<AccountOverview />, { wrapper: Wrapper });
        await user.click(await screen.findByRole('tab', { name: 'Advisories' }));
        const advisories = within(screen.getByRole('tabpanel', { name: 'Advisories' }));
        for (const label of ['Critical', 'Warning', 'Informational', 'High impact', 'Medium impact', 'Low impact']) {
            const badge = await advisories.findByText(label);
            expect(badge).toBeVisible();
            expect(badge).toHaveClass(badgeClassNames.root);
            expect(badge).not.toHaveAttribute('tabindex');
            expect(badge).not.toHaveAttribute('aria-hidden');
            const card = badge.closest(`.${cardClassNames.root}`);
            expect(card).not.toBeNull();
            expect(card).not.toHaveAttribute('tabindex');
        }
        const alertLinks = advisories.getAllByRole('button', { name: 'View in Azure portal' });
        expect(alertLinks).toHaveLength(3);
        expect(alertLinks[0]).toHaveTextContent('View in Azure portal');
        expect(alertLinks[0]).toHaveAccessibleDescription('View alert Critical alert in the Azure portal');
        await user.click(screen.getByRole('tab', { name: 'Databases and Containers' }));
        const hot = await screen.findByText('Hot');
        expect(hot).toBeVisible();
        expect(hot).toHaveClass(badgeClassNames.root);
        expect(hot).not.toHaveAttribute('tabindex');
        expect(hot).not.toHaveAttribute('aria-hidden');
    });

    it('defaults to Monitoring with three peer tabs and expanded Account details', async () => {
        const user = userEvent.setup();
        const { container } = render(<AccountOverview />, { wrapper: Wrapper });
        const monitoring = await screen.findByRole('tab', { name: 'Monitoring' });
        const cards = container.querySelectorAll(`.${cardClassNames.root}`);
        expect(cards).toHaveLength(6);
        for (const card of cards) {
            expect(card).not.toHaveAttribute('tabindex');
        }
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
        expect(screen.getByRole('heading', { name: 'Alerts' })).toBeVisible();
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
        const monitoring = await screen.findByRole('tab', { name: 'Monitoring' });
        // Initial navigation focuses this tab after it mounts; let it finish before moving to a tile.
        await waitFor(() => expect(monitoring).toHaveFocus());
        const tile = screen.getByRole('button', { name: /^Document count/ });
        expect(tile).toHaveTextContent('Document count');
        expect(tile).toHaveAccessibleName(/Document count/);
        tile.focus();
        expect(tile).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(tile).toHaveFocus();
        expect(screen.getByRole('heading', { name: 'Document count trend' })).toBeVisible();
        expect(tile).toHaveAttribute('aria-pressed', 'true');
        const eye = screen.getByRole('button', { name: 'Show chart: Server-side latency' });
        eye.focus();
        expect(eye).toHaveFocus();
        await user.keyboard(' ');
        expect(eye).toHaveFocus();
        expect(screen.getByRole('heading', { name: 'Server-side latency trend' })).toBeVisible();
        expect(eye).toHaveAttribute('aria-pressed', 'true');
    });

    it.each(METRIC_ORDER)(
        'opens the %s card from the submenu without changing filters or adding queries',
        async (metric) => {
            const user = userEvent.setup();
            render(<AccountOverview />, { wrapper: Wrapper });
            await screen.findByRole('tab', { name: 'Monitoring' });
            await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
            await chooseHeaderOption(user, /^Database scope for metrics:/, 'database');
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
            expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveAccessibleName(
                'Metric time range: Last 7 days',
            );
            expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveTextContent('Last 7 days');
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveAccessibleName(
                'Database scope for metrics: database',
            );
            expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveTextContent(
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
        expect(screen.getByRole('combobox', { name: /^Select a container for partition health:/ })).toHaveTextContent(
            'products · database',
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
        await chooseHeaderOption(user, /^Metric time range:/, 'Last 7 days');
        act(() => callbacks.onError());
        expect(screen.getByRole('alert')).toHaveTextContent('Account Overview navigation could not be loaded.');
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(queries.unsubscribe).toHaveBeenCalledTimes(1);
        expect(queries.navigation).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveAccessibleName(
            'Metric time range: Last 7 days',
        );
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveTextContent('Last 7 days');
    });
});
