/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import {
    accordionHeaderClassNames,
    accordionPanelClassNames,
    badgeClassNames,
    dropdownClassNames,
    FluentProvider,
    optionClassNames,
    webLightTheme,
} from '@fluentui/react-components';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountMetricApplicability } from '../../../panels/accountOverview/metrics/contracts';
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
    metricApplicability: getAccountMetricApplicability(false),
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
        onRefresh: vi.fn(),
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
    it('places the shared feedback menu beside Refresh and keeps it usable while metrics load', async () => {
        const user = userEvent.setup();
        const onProvideFeedback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        renderHeader({ onProvideFeedback, loading: true });
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        const feedback = screen.getByRole('button', { name: 'Provide Feedback' });
        expect(refresh.nextElementSibling).toContainElement(feedback);
        expect(feedback).toHaveAccessibleName('Provide Feedback');
        expect(feedback).not.toBeDisabled();
        feedback.focus();
        await user.keyboard('{Enter}');
        const item = await screen.findByRole('menuitem', { name: 'Provide Feedback' });
        expect(item).toHaveTextContent('Provide Feedback');
        expect(item).toHaveAccessibleName('Provide Feedback');
        await user.click(item);
        expect(onProvideFeedback).toHaveBeenCalledOnce();
        expect(feedback).toHaveFocus();
    });

    it('locks Refresh and both filters during initial loading without showing a refresh operation', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ refreshDisabled: true });
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh).toHaveTextContent('Refresh');
        expect(refresh).toHaveAccessibleName('Refresh');
        expect(refresh).toHaveAccessibleDescription('Account data is still loading.');
        expect(refresh).toHaveAttribute('aria-busy', 'false');
        expect(refresh).toHaveAttribute('aria-disabled', 'true');
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
        refresh.focus();
        await user.keyboard('{Enter} ');
        await user.click(refresh);
        expect(props.onRefresh).not.toHaveBeenCalled();
        expect(refresh).toHaveFocus();
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            const select = screen.getByRole('combobox', { name });
            expect(select).toHaveAttribute('aria-disabled', 'true');
            expect(select).not.toBeDisabled();
            expect(select).toHaveAccessibleDescription('Account data is still loading.');
            await user.click(select);
        }
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
        rerender(<AccountHeader {...props} refreshDisabled={false} />);
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            expect(screen.getByRole('combobox', { name })).not.toHaveAttribute('aria-disabled', 'true');
        }
        expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
        expect(refresh).not.toHaveAccessibleDescription();
        await user.click(refresh);
        expect(props.onRefresh).toHaveBeenCalledOnce();
    });

    it('shows refresh activity without changing the button name or losing focus, and locks both filters', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader();
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        refresh.focus();
        rerender(<AccountHeader {...props} loading />);
        expect(refresh).toHaveAccessibleName('Refresh');
        expect(refresh).toHaveTextContent('Refresh');
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        expect(refresh).toHaveAttribute('aria-disabled', 'true');
        expect(refresh).toHaveAccessibleDescription('Updating…');
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
        expect(refresh.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(refresh).toHaveFocus();
        await user.keyboard('{Enter} ');
        await user.click(refresh);
        expect(props.onRefresh).not.toHaveBeenCalled();
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            const select = screen.getByRole('combobox', { name });
            expect(select).toHaveAttribute('aria-disabled', 'true');
            expect(select).toHaveAccessibleDescription('Updating…');
        }
        rerender(<AccountHeader {...props} loading={false} />);
        expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
        expect(refresh).toHaveAttribute('aria-busy', 'false');
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
        expect(refresh).toHaveFocus();
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            expect(screen.getByRole('combobox', { name })).not.toHaveAttribute('aria-disabled', 'true');
        }
        await user.click(refresh);
        expect(props.onRefresh).toHaveBeenCalledOnce();
    });

    it('keeps locked filters in the Tab order without allowing mouse, keyboard or type-ahead selection', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ loading: true, databaseIds: ['alpha', 'beta'] });
        for (const name of [/^Metric time range:/, /^Database scope for metrics:/]) {
            await user.tab();
            const select = screen.getByRole('combobox', { name });
            expect(select).toHaveFocus();
            expect(select).toHaveAttribute('aria-disabled', 'true');
            await user.keyboard('{ArrowDown}{Enter} {Home}{End}alpha');
            await user.click(select);
            expect(select).toHaveFocus();
            expect(select).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        }
        await user.tab();
        expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
        rerender(<AccountHeader {...props} loading={false} />);
        await user.tab({ shift: true });
        const database = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
        expect(database).toHaveFocus();
        await user.keyboard('{Enter}{ArrowDown}{Enter}');
        expect(props.onSelectContainer).toHaveBeenCalledExactlyOnceWith({ databaseId: 'alpha' });
    });

    it.each([
        ['Metric time range', 'Last 7 days'],
        ['Database scope for metrics', 'alpha'],
    ])('retains %s focus when loading begins and finishes without resetting its value', async (label, value) => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({
            databaseIds: ['alpha'],
            timeRange: '7D',
            selectedContainer: { databaseId: 'alpha' },
        });
        const select = screen.getByRole('combobox', { name: `${label}: ${value}` });
        select.focus();
        rerender(<AccountHeader {...props} loading />);
        expect(select).toHaveFocus();
        expect(select).toHaveTextContent(value);
        expect(select).toHaveAccessibleName(`${label}: ${value}`);
        expect(select).toHaveAttribute('aria-disabled', 'true');
        expect(select).toHaveAccessibleDescription('Updating…');
        await user.keyboard('{Enter}{ArrowDown}{Enter}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
        rerender(<AccountHeader {...props} loading={false} />);
        expect(select).toHaveFocus();
        expect(select).not.toHaveAttribute('aria-disabled', 'true');
        expect(select).not.toHaveAccessibleDescription();
    });

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
        expect(toggle).toHaveClass(accordionHeaderClassNames.button);
        expect(toggle).toHaveTextContent('Account details');
        expect(toggle).toHaveAccessibleName('Account details');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        const details = document.getElementById(toggle.getAttribute('aria-controls')!)!;
        expect(details).toHaveAttribute('inert');
        toggle.focus();
        await user.keyboard('{Enter}');
        expect(details).not.toHaveAttribute('inert');
        expect(details).toHaveClass(accordionPanelClassNames.root);
        expect(details).toBeVisible();
        expect(details).toHaveAttribute('id', toggle.getAttribute('aria-controls'));
        expect(details).toHaveAttribute('aria-labelledby', toggle.id);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveFocus();
        await user.keyboard(' ');
        expect(details).toHaveAttribute('inert');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
    });

    it('shows eleven essential fields and moves API and Consistency into additional properties', () => {
        renderHeader({ defaultEssentialsOpen: true });
        const region = screen.getByRole('region', { name: 'Account details' });
        const details = within(region);
        const fields = [
            ['Status', 'Online'],
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
        const additionalPanel = document.getElementById(
            details.getByRole('button', { name: 'Additional account properties' }).getAttribute('aria-controls')!,
        )!;
        expect(additionalPanel).toHaveAttribute('inert');
        for (const label of ['API type', 'Consistency', 'Automatic failover']) {
            expect(additionalPanel).toContainElement(details.getByText(label));
        }
        expect(details.getByRole('button', { name: 'Additional account properties' })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('uses a keyboard-accessible Accordion for additional properties and preserves its state when details collapse', async () => {
        const user = userEvent.setup();
        const { props } = renderHeader({ defaultEssentialsOpen: true });
        const toggle = screen.getByRole('button', { name: 'Additional account properties' });
        expect(toggle).toHaveClass(accordionHeaderClassNames.button);
        expect(toggle).toHaveTextContent('Additional account properties');
        expect(toggle).toHaveAccessibleName('Additional account properties');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        screen.getByRole('button', { name: 'View JSON' }).focus();
        await user.tab();
        expect(toggle).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const panel = screen.getByRole('region', { name: 'Additional account properties' });
        expect(panel).toHaveClass(accordionPanelClassNames.root);
        expect(panel).toHaveAttribute('id', toggle.getAttribute('aria-controls'));
        expect(panel).toHaveAttribute('aria-labelledby', toggle.id);
        expect(toggle).toHaveFocus();
        for (const [label, value] of [
            ['API type', 'NoSQL'],
            ['Consistency', 'Session'],
            ['Automatic failover', 'Unknown'],
        ]) {
            const field = screen.getByText(label).parentElement!;
            expect(within(field).getByText(value)).toBeVisible();
        }
        const detailsToggle = screen.getByRole('button', { name: 'Account details' });
        await user.click(detailsToggle);
        expect(document.getElementById(detailsToggle.getAttribute('aria-controls')!)).toHaveAttribute('inert');
        await user.click(detailsToggle);
        expect(panel).toBeVisible();
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        toggle.focus();
        await user.keyboard(' ');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(panel).toHaveAttribute('inert');
        expect(toggle).toHaveFocus();
        expect(props.onAccountAction).not.toHaveBeenCalled();
    });

    it('keeps the additional-properties toggle in the same action row when expanded and closed', async () => {
        const user = userEvent.setup();
        renderHeader({ defaultEssentialsOpen: true });
        const toggle = screen.getByRole('button', { name: 'Additional account properties' });
        const actions = screen.getByRole('button', { name: 'View Cost' }).parentElement!;
        const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
        const rowClass = actions.className;
        expect(actions).toContainElement(toggle);
        expect(actions).toContainElement(screen.getByRole('button', { name: 'View JSON' }));
        expect(actions).not.toContainElement(panel);
        expect(actions.nextElementSibling).toBe(panel);
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(actions).toContainElement(toggle);
        expect(actions.className).toBe(rowClass);
        expect(panel).not.toHaveAttribute('inert');
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(panel).toHaveAttribute('inert');
        expect(toggle).toHaveFocus();
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
        ['View Cost', 'openCosts'],
        ['View JSON', 'openJson'],
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
        for (const label of ['View Cost', 'View JSON']) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            await user.click(button);
        }
        expect(props.onAccountAction).not.toHaveBeenCalled();
        rerender(<AccountHeader {...props} accountActionBusy={false} />);
        for (const label of ['View Cost', 'View JSON']) {
            expect(screen.getByRole('button', { name: label })).toBeEnabled();
        }
    });

    it('calls Refresh without changing filters', async () => {
        const user = userEvent.setup();
        const { props } = renderHeader();
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh).toHaveTextContent('Refresh');
        expect(refresh).toHaveAccessibleName('Refresh');
        await user.click(refresh);
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
    });

    it('shows the chart generation date and time before the filters without auto-refresh settings or a focus stop', async () => {
        const user = userEvent.setup();
        const generatedAt = Date.UTC(2026, 9, 14, 12, 25, 6);
        const { props, rerender } = renderHeader({ lastRefreshedAt: generatedAt });
        const timestamp = new Date(generatedAt).toLocaleString(undefined, {
            dateStyle: 'short',
            timeStyle: 'medium',
        });
        const time = screen.getByText(`Charts generated at ${timestamp}`);
        expect(time).toBeVisible();
        expect(time.tagName).toBe('TIME');
        expect(time).toHaveAttribute('datetime', new Date(generatedAt).toISOString());
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh.parentElement).toContainElement(time);
        const range = screen.getByRole('combobox', { name: /^Metric time range:/ });
        expect(time.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(screen.queryByRole('button', { name: 'Refresh options' })).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: 'Pause auto-refresh' })).not.toBeInTheDocument();
        refresh.focus();
        await user.tab();
        expect(screen.getByText(/^Total throughput limit:/)).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Account details' })).toHaveFocus();
        rerender(<AccountHeader {...props} loading />);
        expect(time).toBeVisible();
        expect(time).toHaveTextContent(`Charts generated at ${timestamp}`);
    });

    it('does not invent a chart generation timestamp before results are available', () => {
        renderHeader({ lastRefreshedAt: undefined });
        expect(screen.queryByText(/^Charts generated at/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    });

    it.each([
        ['1H', 'Last hour'],
        ['24H', 'Last 24 hours'],
        ['7D', 'Last 7 days'],
    ] as const)('selects %s and includes its visible label in the accessible name', async (timeRange, label) => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ timeRange: timeRange === '24H' ? '1H' : '24H' });
        const select = screen.getByRole('combobox', { name: /^Metric time range:/ });
        expect(select).toHaveClass(dropdownClassNames.button);
        await user.click(select);
        const option = screen.getByRole('option', { name: label });
        expect(option).toHaveClass(optionClassNames.root);
        await user.click(option);
        expect(props.onTimeRangeChange).toHaveBeenCalledExactlyOnceWith(timeRange);
        rerender(<AccountHeader {...props} timeRange={timeRange} />);
        expect(select).toHaveTextContent(label);
        expect(select).toHaveAccessibleName(`Metric time range: ${label}`);
        expect(select).toHaveAttribute('aria-expanded', 'false');
        await user.click(select);
        expect(screen.getByRole('option', { name: label, selected: true })).toBeVisible();
        await user.keyboard('{Escape}');
        expect(select).toHaveFocus();
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
        expect(select).toHaveClass(dropdownClassNames.button);
        expect(select).toHaveTextContent('All databases');
        expect(select).toHaveAccessibleName('Database scope for metrics: All databases');
        await user.click(select);
        expect(
            within(screen.getByRole('listbox'))
                .getAllByRole('option')
                .map((option) => option.textContent),
        ).toEqual(['All databases', '-1', '0', 'account', 'zebra']);
        expect(screen.getByRole('option', { name: 'All databases', selected: true })).toBeVisible();
        await user.keyboard('{Escape}');
        for (const databaseId of ['-1', '0', 'account', 'zebra']) {
            await user.click(select);
            await user.click(screen.getByRole('option', { name: databaseId }));
            expect(props.onSelectContainer).toHaveBeenLastCalledWith({ databaseId });
            rerender(<AccountHeader {...props} selectedContainer={{ databaseId }} />);
            expect(select).toHaveTextContent(databaseId);
            expect(select).toHaveAccessibleName(`Database scope for metrics: ${databaseId}`);
            await user.click(select);
            expect(screen.getByRole('option', { name: databaseId, selected: true })).toBeVisible();
            await user.keyboard('{Escape}');
        }
        await user.click(select);
        await user.click(screen.getByRole('option', { name: 'All databases' }));
        expect(props.onSelectContainer).toHaveBeenLastCalledWith(undefined);
        rerender(<AccountHeader {...props} selectedContainer={undefined} />);
        expect(select).toHaveTextContent('All databases');
        expect(select).toHaveAccessibleName('Database scope for metrics: All databases');
    });

    it('keeps All databases available with no inventory', async () => {
        const user = userEvent.setup();
        renderHeader();
        const select = screen.getByRole('combobox', { name: 'Database scope for metrics: All databases' });
        expect(select).toHaveTextContent('All databases');
        expect(select).not.toBeDisabled();
        await user.click(select);
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option', { name: 'All databases', selected: true })).toBeVisible();
    });

    it('keeps the Fluent selectors in keyboard order before Refresh', async () => {
        const user = userEvent.setup();
        renderHeader();
        await user.tab();
        expect(screen.getByRole('combobox', { name: /^Metric time range:/ })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('combobox', { name: /^Database scope for metrics:/ })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();
    });

    it.each([
        {
            name: /^Metric time range:/,
            label: 'Last 7 days',
            callback: 'onTimeRangeChange',
            expected: '7D',
            update: { timeRange: '7D' },
        },
        {
            name: /^Database scope for metrics:/,
            label: 'alpha',
            callback: 'onSelectContainer',
            expected: { databaseId: 'alpha' },
            update: { selectedContainer: { databaseId: 'alpha' } },
        },
    ] as const)('supports keyboard selection and Escape cancellation for $callback', async (testCase) => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({ databaseIds: ['alpha', 'beta'] });
        const select = screen.getByRole('combobox', { name: testCase.name });
        select.focus();
        await user.keyboard('{Enter}');
        expect(select).toHaveAttribute('aria-expanded', 'true');
        const listbox = screen.getByRole('listbox');
        expect(listbox).toHaveAttribute('id', select.getAttribute('aria-controls'));
        expect(listbox.parentElement).toBe(select.parentElement);
        await user.keyboard('{ArrowDown}{Escape}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(select).toHaveFocus();
        expect(props.onTimeRangeChange).not.toHaveBeenCalled();
        expect(props.onSelectContainer).not.toHaveBeenCalled();
        await user.keyboard('{Enter}{ArrowDown}{Enter}');
        expect(props[testCase.callback]).toHaveBeenCalledExactlyOnceWith(testCase.expected);
        rerender(<AccountHeader {...props} {...testCase.update} />);
        expect(select).toHaveTextContent(testCase.label);
        expect(select).toHaveAccessibleName(new RegExp(testCase.label));
        expect(select).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(select).toHaveFocus();
        expect(props.onRefresh).not.toHaveBeenCalled();
    });

    it('sorts explicit database IDs, deduplicates them, and allows selecting a database with no containers', async () => {
        const user = userEvent.setup();
        const { props, rerender } = renderHeader({
            databaseIds: ['z-empty', 'database', 'z-empty'],
            containers: [{ databaseId: 'database', containerId: 'orders' }],
        });
        const select = screen.getByRole('combobox', { name: /^Database scope for metrics:/ });
        expect(select).toHaveClass(dropdownClassNames.button);
        await user.click(select);
        expect(
            within(screen.getByRole('listbox'))
                .getAllByRole('option')
                .map((option) => option.textContent),
        ).toEqual(['All databases', 'database', 'z-empty']);
        await user.click(screen.getByRole('option', { name: 'z-empty' }));
        expect(props.onSelectContainer).toHaveBeenCalledExactlyOnceWith({ databaseId: 'z-empty' });
        rerender(<AccountHeader {...props} selectedContainer={{ databaseId: 'z-empty' }} />);
        expect(select).toHaveTextContent('z-empty');
        expect(select).toHaveAccessibleName('Database scope for metrics: z-empty');
    });

    it('respects an explicitly empty database list instead of falling back to container rows', async () => {
        const user = userEvent.setup();
        renderHeader({ databaseIds: [], containers: [{ databaseId: 'stale', containerId: 'orders' }] });
        const select = screen.getByRole('combobox', { name: 'Database scope for metrics: All databases' });
        expect(select).toHaveTextContent('All databases');
        expect(select).toBeEnabled();
        await user.click(select);
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option', { name: 'All databases', selected: true })).toBeVisible();
    });

    it.each([
        ['Succeeded', 'Unknown', false],
        ['Creating', 'Needs Attention', true],
        ['Updating', 'Needs Attention', true],
        ['Deleting', 'Needs Attention', true],
        ['Failed', 'Critical', true],
        ['Canceled', 'Critical', true],
        [undefined, 'Unknown', false],
    ] as const)('falls back to provisioning health for %s', (provisioningState, label, focusable) => {
        renderHeader({ summary: { ...summary, provisioningState } });
        expect(screen.getByRole('status')).toHaveTextContent(`Account health: ${label}`);
        const badge = screen.getByLabelText(label, { selector: `.${badgeClassNames.root}` });
        expect(badge).toBeVisible();
        expect(badge).toHaveClass(badgeClassNames.root);
        expect(badge.tabIndex).toBe(focusable ? 0 : -1);
        expect(badge).not.toHaveAttribute('aria-hidden');
        expect(badge.querySelector(`.${badgeClassNames.icon} > span`)).toHaveAttribute('aria-hidden', 'true');
        expect(badge.parentElement?.tagName).toBe('DIV');
    });

    it.each([
        ['Succeeded', 'Critical'],
        ['Succeeded', 'Needs Attention'],
        ['Failed', 'Critical'],
    ] as const)('separates %s provisioning status from %s health', (provisioningState, accountHealth) => {
        renderHeader({ summary: { ...summary, provisioningState }, accountHealth, defaultEssentialsOpen: true });
        expect(screen.getByRole('status')).toHaveTextContent(`Account health: ${accountHealth}`);
        expect(screen.getAllByText(accountHealth)).toHaveLength(1);
        const details = within(screen.getByRole('region', { name: 'Account details' }));
        expect(
            within(details.getByText('Status').parentElement!).getByText(
                provisioningState === 'Succeeded' ? 'Online' : provisioningState,
            ),
        ).toBeVisible();
        expect(details.queryByText(accountHealth)).not.toBeInTheDocument();
    });

    it('does not let a successful request signal hide a failed provisioning state', () => {
        renderHeader({ summary: { ...summary, provisioningState: 'Failed' }, accountHealth: 'Healthy' });
        expect(screen.getByRole('status')).toHaveTextContent('Account health: Critical');
    });

    it('exposes the health explanation on keyboard focus without replacing the visible badge name', async () => {
        const user = userEvent.setup();
        renderHeader({ summary: { ...summary, provisioningState: 'Failed' } });
        const badge = screen.getByLabelText('Critical', { selector: `.${badgeClassNames.root}` });
        await user.keyboard('{Tab}');
        act(() => badge.focus());
        expect(badge).toHaveFocus();
        expect(badge).toHaveAccessibleName('Critical');
        expect(badge).toHaveAccessibleDescription(
            'Resource provisioning state: Failed. See Status in Account details.',
        );
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Resource provisioning state: Failed.');
        await user.keyboard('{Escape}');
        expect(badge).toHaveFocus();
    });

    it.each([
        [undefined, 'Unknown'],
        [null, 'Unknown'],
        [-2, 'Unknown'],
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

    it.each([undefined, null, -1, 0, 4000])(
        'omits the Serverless throughput limit in status and details even with ARM value %s',
        (totalThroughputLimit) => {
            renderHeader({
                summary: { ...summary, isServerless: true, totalThroughputLimit },
                defaultEssentialsOpen: true,
            });
            expect(screen.queryByText(/^Total throughput limit/)).not.toBeInTheDocument();
            expect(screen.queryByText('Total throughput limit')).not.toBeInTheDocument();
            expect(screen.getByText('Capacity mode: Serverless')).toBeVisible();
        },
    );
});
