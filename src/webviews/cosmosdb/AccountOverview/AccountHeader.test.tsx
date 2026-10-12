/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountHeader, type AccountSummary } from './AccountHeader';

type HeaderProps = ComponentProps<typeof AccountHeader>;

const summary: AccountSummary = {
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
    backupPolicyType: 'Continuous',
    totalThroughputLimit: 4000,
    writeRegions: ['East US'],
    readRegions: ['East US', 'West US'],
    writeRegionCount: 1,
    readRegionCount: 2,
    lastRefreshedAt: 1000,
};

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

function renderHeader(overrides: Partial<HeaderProps> = {}) {
    const props: HeaderProps = {
        summary,
        lastRefreshedAt: 2000,
        paused: false,
        onTogglePause: vi.fn(),
        onRefresh: vi.fn(),
        autoRefreshIntervalsSeconds: { metrics: 60, inventory: 120, alerts: 300 },
        timeRange: '24H',
        onTimeRangeChange: vi.fn(),
        containers: [],
        onSelectContainer: vi.fn(),
        accountActionBusy: false,
        onAccountAction: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<AccountHeader {...props} />, { wrapper: Wrapper }) };
}

beforeEach(() => {
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

describe('AccountHeader', () => {
    it('shows account identity with a decorative Cosmos icon and deduplicated regions', () => {
        const { container } = renderHeader();
        expect(screen.getByRole('heading', { level: 1, name: summary.accountName })).toBeVisible();
        expect(screen.getByText('Azure Cosmos DB account')).toBeVisible();
        expect(container.querySelector('img')).toHaveAttribute('alt', '');
        expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('azurecosmosdb.png'));
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('Regions: East US, West US')).toBeVisible();
        expect(screen.getByText('Capacity mode: Provisioned throughput')).toBeVisible();
    });

    it('opens and closes Account details with Enter and Space while maintaining its ARIA relationship', async () => {
        const user = userEvent.setup();
        renderHeader();
        const toggle = screen.getByRole('button', { name: 'Account details' });
        expect(toggle).toHaveTextContent('Account details');
        expect(toggle).toHaveAccessibleName('Account details');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('region', { name: 'Account details' })).not.toBeInTheDocument();
        toggle.focus();
        await user.keyboard('{Enter}');
        const details = screen.getByRole('region', { name: 'Account details' });
        expect(details).toBeVisible();
        expect(details).toHaveAttribute('id', toggle.getAttribute('aria-controls'));
        expect(details).toHaveAttribute('aria-labelledby', toggle.id);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveFocus();
        await user.keyboard(' ');
        expect(details).not.toBeVisible();
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
    });

    it('shows eleven essential fields and moves API and Consistency into additional properties', () => {
        renderHeader({ defaultEssentialsOpen: true });
        const region = screen.getByRole('region', { name: 'Account details' });
        const details = within(region);
        const fields = [
            ['Status', 'Healthy'],
            ['Resource group', summary.resourceGroup],
            ['Subscription', summary.subscriptionName],
            ['Subscription ID', summary.subscriptionId],
            ['URI', summary.documentEndpoint],
            ['Capacity mode', 'Provisioned throughput'],
            ['Total throughput limit', `${(4000).toLocaleString()} RU/s`],
            ['Backup policy', 'Continuous'],
            ['Free tier', 'Opted out'],
            ['Write locations', 'East US'],
            ['Read locations', 'East US, West US'],
        ];
        expect(region.firstElementChild?.children).toHaveLength(11);
        for (const [label, value] of fields) {
            const field = details.getByText(label).parentElement;
            if (!field) {
                throw new Error(`Missing detail field: ${label}`);
            }
            expect(within(field).getByText(value)).toBeVisible();
        }
        for (const label of ['API type', 'Consistency', 'Automatic failover']) {
            expect(details.getByText(label)).not.toBeVisible();
            expect(details.getByText(label).closest('details')).not.toHaveAttribute('open');
        }
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('keeps additional properties in a native, keyboard-focusable disclosure', async () => {
        const user = userEvent.setup();
        const { props } = renderHeader({ defaultEssentialsOpen: true });
        const toggle = screen.getByText('Additional account properties');
        expect(toggle.tagName).toBe('SUMMARY');
        expect(toggle.parentElement?.tagName).toBe('DETAILS');
        expect(toggle).toHaveAccessibleName('Additional account properties');
        expect(toggle.parentElement).not.toHaveAttribute('open');
        screen.getByRole('button', { name: 'JSON view' }).focus();
        await user.tab();
        expect(toggle).toHaveFocus();
        // jsdom implements native summary click activation, but not its browser keyboard default action.
        await user.click(toggle);
        expect(toggle.parentElement).toHaveAttribute('open');
        for (const [label, value] of [
            ['API type', 'NoSQL'],
            ['Consistency', 'Session'],
            ['Automatic failover', 'Unknown'],
        ]) {
            const field = screen.getByText(label).parentElement!;
            expect(within(field).getByText(value)).toBeVisible();
        }
        await user.click(toggle);
        expect(toggle.parentElement).not.toHaveAttribute('open');
        expect(screen.getByText('API type')).not.toBeVisible();
        expect(props.onAccountAction).not.toHaveBeenCalled();
    });

    it.each([
        [true, 'Enabled'],
        [false, 'Disabled'],
        [undefined, 'Unknown'],
    ] as const)(
        'renders automatic failover %s without inventing a setting',
        async (automaticFailoverEnabled, label) => {
            const user = userEvent.setup();
            renderHeader({
                defaultEssentialsOpen: true,
                summary: { ...summary, automaticFailoverEnabled, consistencyLevel: undefined },
            });
            await user.click(screen.getByText('Additional account properties'));
            expect(within(screen.getByText('Automatic failover').parentElement!).getByText(label)).toBeVisible();
            expect(within(screen.getByText('Consistency').parentElement!).getByText('Unknown')).toBeVisible();
        },
    );

    it.each([
        [{ backupPolicyType: undefined }, 'Unknown'],
        [{ backupPolicyType: 'Periodic' }, 'Periodic'],
        [
            { backupPolicyType: 'Periodic', backupIntervalMinutes: 240, backupRetentionHours: 48 },
            'Periodic (2 days retention); backup every 240 minutes',
        ],
        [
            { backupPolicyType: 'Periodic', backupIntervalMinutes: 60, backupRetentionHours: 8 },
            'Periodic (8 hours retention); backup every 60 minutes',
        ],
        [{ continuousBackupTier: 'Continuous7Days' }, 'Continuous (Continuous7Days)'],
        [{ continuousBackupTier: 'Continuous30Days', backupRetentionHours: 168 }, 'Continuous (7 days retention)'],
        [{ backupIntervalMinutes: 240 }, 'Continuous'],
    ] satisfies [Partial<AccountSummary>, string][])('renders optional backup metadata %j', (backup, label) => {
        renderHeader({ defaultEssentialsOpen: true, summary: { ...summary, ...backup } });
        expect(within(screen.getByText('Backup policy').parentElement!).getByText(label)).toBeVisible();
    });

    it.each([
        ['View cost', 'openCosts'],
        ['JSON view', 'openJson'],
    ] as const)('dispatches %s from its visible, keyboard-accessible label', async (label, action) => {
        const user = userEvent.setup();
        const { props } = renderHeader({ defaultEssentialsOpen: true });
        const button = screen.getByRole('button', { name: label });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        button.focus();
        await user.keyboard('{Enter}');
        expect(props.onAccountAction).toHaveBeenCalledExactlyOnceWith({ action });
        expect(props.onRefresh).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
    });

    it('disables both detail actions while busy and re-enables them when complete', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ defaultEssentialsOpen: true, accountActionBusy: true });
        for (const label of ['View cost', 'JSON view']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        expect(props.onAccountAction).not.toHaveBeenCalled();
        rerender(<AccountHeader {...props} accountActionBusy={false} />);
        for (const label of ['View cost', 'JSON view']) {
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
        }
    });

    it('calls Refresh without changing filters or pause state', async () => {
        const user = userEvent.setup();
        const { props } = renderHeader();
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh).toHaveTextContent('Refresh');
        expect(refresh).toHaveAccessibleName('Refresh');
        await user.click(refresh);
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
        expect(props.onTogglePause).not.toHaveBeenCalled();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
    });

    it('opens refresh options by keyboard, pauses and resumes, and restores focus after Escape', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader();
        const trigger = screen.getByRole('button', { name: 'Refresh options' });
        expect(trigger).toHaveTextContent('Refresh options');
        expect(trigger).toHaveAccessibleName('Refresh options');
        expect(screen.queryByRole('switch', { name: 'Pause auto-refresh' })).not.toBeInTheDocument();
        trigger.focus();
        await user.keyboard('{Enter}');
        const pause = screen.getByRole('switch', { name: 'Pause auto-refresh' });
        expect(screen.getByText('Pause auto-refresh')).toBeVisible();
        expect(pause).toHaveAccessibleName('Pause auto-refresh');
        await waitFor(() => expect(pause).toHaveFocus());
        const timestamp = new Date(props.lastRefreshedAt).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        expect(screen.getByText(`Last refreshed at ${timestamp}`)).toBeVisible();
        expect(pause).not.toBeChecked();
        await user.keyboard(' ');
        expect(props.onTogglePause).toHaveBeenLastCalledWith(true);
        rerender(<AccountHeader {...props} paused />);
        expect(pause).toBeChecked();
        expect(trigger).toHaveTextContent('Auto-refresh paused');
        expect(trigger).toHaveAccessibleName('Auto-refresh paused');
        await user.keyboard(' ');
        expect(props.onTogglePause).toHaveBeenLastCalledWith(false);
        expect(props.onTogglePause).toHaveBeenCalledTimes(2);
        rerender(<AccountHeader {...props} paused={false} />);
        expect(pause).not.toBeChecked();
        await user.keyboard('{Escape}');
        await waitFor(() =>
            expect(screen.queryByRole('switch', { name: 'Pause auto-refresh' })).not.toBeInTheDocument(),
        );
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(trigger).toHaveAccessibleName('Refresh options');
        expect(props.onRefresh).not.toHaveBeenCalled();
    });

    it.each([
        ['1H', 'Last hour'],
        ['24H', 'Last 24 hours'],
        ['7D', 'Last 7 days'],
    ] as const)('selects %s and includes its visible label in the accessible name', async (timeRange, label) => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ timeRange: timeRange === '24H' ? '1H' : '24H' });
        const select = screen.getByRole('combobox', { name: /^Metric time range:/ });
        expect(select.tagName).toBe('SELECT');
        await user.selectOptions(select, timeRange);
        expect(props.onTimeRangeChange).toHaveBeenCalledExactlyOnceWith(timeRange);
        rerender(<AccountHeader {...props} timeRange={timeRange} />);
        expect(select).toHaveValue(timeRange);
        expect(select).toHaveDisplayValue(label);
        expect(select).toHaveAccessibleName(`Metric time range: ${label}`);
    });

    it('sorts and deduplicates databases without confusing account or numeric names with All databases', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({
            containers: [
                { databaseId: 'zebra', containerId: 'one' },
                { databaseId: 'account', containerId: 'one' },
                { databaseId: '-1', containerId: 'one' },
                { databaseId: 'account', containerId: 'two' },
                { databaseId: '0', containerId: 'one' },
            ],
        });
        const select = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
        expect(select).toHaveValue('-1');
        expect(select).toHaveDisplayValue('All databases');
        expect(select).toHaveAccessibleName('Database scope for metrics: All databases');
        expect(
            within(select)
                .getAllByRole('option')
                .map((option) => option.textContent),
        ).toEqual(['All databases', '-1', '0', 'account', 'zebra']);
        for (const [index, databaseId] of ['-1', '0', 'account', 'zebra'].entries()) {
            await user.selectOptions(select, String(index));
            expect(props.onSelectContainer).toHaveBeenLastCalledWith({ databaseId });
            rerender(<AccountHeader {...props} selectedContainer={{ databaseId }} />);
            expect(select).toHaveValue(String(index));
            expect(select).toHaveDisplayValue(databaseId);
            expect(select).toHaveAccessibleName(`Database scope for metrics: ${databaseId}`);
        }
        await user.selectOptions(select, '-1');
        expect(props.onSelectContainer).toHaveBeenLastCalledWith(undefined);
        rerender(<AccountHeader {...props} selectedContainer={undefined} />);
        expect(select).toHaveDisplayValue('All databases');
        expect(select).toHaveAccessibleName('Database scope for metrics: All databases');
    });

    it('keeps All databases available with no inventory', () => {
        renderHeader();
        const select = screen.getByRole('combobox', { name: 'Database scope for metrics: All databases' });
        expect(select).toHaveValue('-1');
        expect(within(select).getAllByRole('option')).toHaveLength(1);
        expect(select).not.toBeDisabled();
    });

    it('sorts explicit database IDs, deduplicates them, and allows selecting a database with no containers', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({
            databaseIds: ['z-empty', 'database', 'z-empty'],
            containers: [{ databaseId: 'database', containerId: 'orders' }],
        });
        const select = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
        expect(select.tagName).toBe('SELECT');
        expect(
            within(select)
                .getAllByRole('option')
                .map((option) => option.textContent),
        ).toEqual(['All databases', 'database', 'z-empty']);
        await user.selectOptions(select, '1');
        expect(props.onSelectContainer).toHaveBeenCalledExactlyOnceWith({ databaseId: 'z-empty' });
        rerender(<AccountHeader {...props} selectedContainer={{ databaseId: 'z-empty' }} />);
        expect(select).toHaveDisplayValue('z-empty');
        expect(select).toHaveAccessibleName('Database scope for metrics: z-empty');
    });

    it('respects an explicitly empty database list instead of falling back to container rows', () => {
        renderHeader({ databaseIds: [], containers: [{ databaseId: 'stale', containerId: 'orders' }] });
        const select = screen.getByRole('combobox', { name: 'Database scope for metrics: All databases' });
        expect(within(select).getAllByRole('option')).toHaveLength(1);
        expect(select).toHaveDisplayValue('All databases');
        expect(select).toBeEnabled();
    });

    it.each([
        ['Succeeded', 'Healthy'],
        ['Creating', 'Needs Attention'],
        ['Updating', 'Needs Attention'],
        ['Deleting', 'Needs Attention'],
        ['Failed', 'Critical'],
        ['Canceled', 'Critical'],
        [undefined, 'Unknown'],
    ] as const)('falls back to provisioning health for %s', (provisioningState, label) => {
        renderHeader({ summary: { ...summary, provisioningState } });
        expect(screen.getByRole('status')).toHaveTextContent(`Account health: ${label}`);
        expect(screen.getAllByText(label)[0]).toBeVisible();
    });

    it.each([
        ['Succeeded', 'Critical'],
        ['Succeeded', 'Needs Attention'],
        ['Failed', 'Healthy'],
    ] as const)('prioritizes derived %s / %s health in the status and details', (provisioningState, accountHealth) => {
        renderHeader({ summary: { ...summary, provisioningState }, accountHealth, defaultEssentialsOpen: true });
        expect(screen.getByRole('status')).toHaveTextContent(`Account health: ${accountHealth}`);
        expect(screen.getAllByText(accountHealth)).toHaveLength(2);
        const details = within(screen.getByRole('region', { name: 'Account details' }));
        expect(details.getByText(accountHealth)).toBeVisible();
    });

    it.each([
        [undefined, 'Unknown'],
        [-1, 'No total throughput limit'],
        [0, '0 RU/s'],
        [4000, `${(4000).toLocaleString()} RU/s`],
    ] as const)('renders throughput cap %s consistently in status and details', (totalThroughputLimit, label) => {
        renderHeader({ summary: { ...summary, totalThroughputLimit }, defaultEssentialsOpen: true });
        expect(screen.getByText(`Total throughput limit: ${label}`)).toBeVisible();
        const details = within(screen.getByRole('region', { name: 'Account details' }));
        expect(within(details.getByText('Total throughput limit').parentElement!).getByText(label)).toBeVisible();
    });

    it('renders serverless capacity and unknown regions without inventing values', () => {
        renderHeader({ summary: { ...summary, isServerless: true, writeRegions: [], readRegions: [] } });
        expect(screen.getByText('Capacity mode: Serverless')).toBeVisible();
        expect(screen.getByText('Regions: Unknown')).toBeVisible();
    });
});
