/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as DashboardChrome from '../AccountOverview/DashboardChrome';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { AccountOverviewV2 } from './AccountOverviewV2';
import { OverviewActions } from './OverviewActions';
import { OverviewDetails } from './OverviewDetails';
import { OverviewFindings } from './OverviewFindings';
import { type OverviewSummaryProps } from './overviewFindingsModel';
import { OverviewHeader } from './OverviewHeader';

vi.mock('../AccountOverview/DashboardChrome', async (importOriginal) => {
    const original = await importOriginal<typeof DashboardChrome>();
    return { ...original, Pill: vi.fn(original.Pill) };
});

vi.mock('./OverviewMetrics', () => ({
    OverviewMetrics: ({ onInspect }: OverviewSummaryProps) => (
        <>
            <button onClick={() => onInspect('metrics', 'serverLatency')}>Inspect latency</button>
            <button onClick={() => onInspect('metrics', 'normalizedRu')}>View RU consumption details</button>
        </>
    ),
}));
vi.mock('./OverviewDetails', async (importOriginal) => {
    const original = await importOriginal<{ OverviewDetails: typeof OverviewDetails }>();
    return {
        detailTitles: {
            metrics: 'Metrics',
            inventory: 'Resources',
            partition: 'Partitions',
            findings: 'Account health',
            recommendations: 'Recommendations',
        },
        OverviewDetails: vi.fn((props: Parameters<typeof OverviewDetails>[0]) =>
            props.section === 'inventory' || props.section === 'partition' ? (
                <div>Detailed evidence</div>
            ) : (
                <original.OverviewDetails {...props} />
            ),
        ),
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function overviewState(): AccountOverviewState {
    return {
        summary: {
            accountName: 'test-account',
            apiType: 'NoSQL',
            resourceGroup: 'test-group',
            subscriptionName: 'test-subscription',
            subscriptionId: 'subscription-id',
            documentEndpoint: 'https://test-account.documents.azure.com',
            isServerless: false,
            provisioningState: 'Succeeded',
            freeTierEnabled: false,
            writeRegions: ['East US'],
            readRegions: ['West US'],
            writeRegionCount: 1,
            readRegionCount: 1,
            lastRefreshedAt: 1,
            totalThroughputLimit: 4000,
        },
        inventory: { supported: true, available: true, databases: ['database'], rows: [] },
        inventoryMetrics: undefined,
        accountHealth: undefined,
        selectedContainer: undefined,
        partitionContainer: undefined,
        partitionHealth: undefined,
        alerts: undefined,
        recommendations: undefined,
        containers: [],
        timeRange: '24H',
        alertTimeRange: '1d',
        lastRefreshedAt: 1,
        paused: false,
        setPaused: vi.fn(),
        setTimeRange: vi.fn(),
        setSelectedContainer: vi.fn(),
        refresh: vi.fn(),
        autoRefreshIntervalsSeconds: { metrics: 60, inventory: 30, alerts: 60 },
        setPartitionMode: vi.fn(),
        setAlertTimeRange: vi.fn(),
        reloadInventory: vi.fn(async () => {}),
        trends: {},
        trendsLoading: false,
        refreshVersion: 0,
        alertsLoading: false,
        recommendationsLoading: false,
        derivedLoading: false,
        partitionLoading: false,
        partitionMode: 'ru',
        handleOpenQueryEditor: vi.fn(),
        handleRevealInTree: vi.fn(),
        handleSelectPartitionContainer: vi.fn(),
        runAccountAction: vi.fn(async () => {}),
        accountActionBusy: false,
        accountActionFailed: false,
        actions: { reportEvent: vi.fn(), openUrl: vi.fn() },
        dismissedAdvisoryIds: new Set(),
        handleDismissAdvisory: vi.fn(),
        handleOpenUrl: vi.fn(),
        derivedAdvisories: {
            available: true,
            generatedAt: 1,
            advisories: [
                {
                    id: 'hot',
                    rule: 'HotPartitionRisk',
                    severity: 'High',
                    title: 'Hot partition',
                    scope: 'database/container',
                    rationale: 'Saturation with headroom elsewhere.',
                    suggestedAction: 'Review the partition key.',
                    thresholdReference: 'Threshold 90%',
                },
            ],
        },
    };
}

describe('compact overview chrome', () => {
    it('keeps derived opportunities below metrics in recommendations even when Advisor has no guidance', () => {
        const overview = overviewState();
        const advisory = overview.derivedAdvisories!.advisories[0];
        overview.derivedAdvisories!.advisories = [
            { ...advisory, id: 'idle', rule: 'IdleContainer', title: 'Idle container' },
            { ...advisory, id: 'over', rule: 'OverProvisioning', title: 'Over-provisioning', scope: undefined },
            {
                ...advisory,
                id: 'serverless',
                rule: 'ServerlessCandidate',
                title: 'Serverless candidate',
                severity: 'Low',
                scope: undefined,
            },
        ];
        overview.recommendations = {
            available: true,
            recommendations: [],
            hasHighImpactPerfCost: false,
            generatedAt: 1,
        };
        render(<AccountOverviewV2 overview={overview} analytics={{ loading: false, failed: false }} />);
        const health = screen.getByRole('region', { name: 'Account health' });
        expect(within(health).queryByRole('row')).not.toBeInTheDocument();
        const recommendations = screen.getByRole('region', { name: 'Prioritized recommendations' });
        for (const title of ['Idle container', 'Over-provisioning', 'Serverless candidate']) {
            expect(within(recommendations).getByRole('heading', { name: title })).toBeVisible();
        }
        expect(within(recommendations).getAllByRole('row')).toHaveLength(3);
        const metrics = screen.getByRole('button', { name: 'Inspect latency' });
        expect(health.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(metrics.compareDocumentPosition(recommendations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each([
        ['Continuous', 720, undefined, 'Continuous (30 days retention)'],
        ['Continuous', 168, undefined, 'Continuous (7 days retention)'],
        ['Periodic', 16, 120, 'Periodic (16 hours retention); backup every 120 minutes'],
        ['Periodic', undefined, 240, 'Periodic; backup every 240 minutes'],
        ['Periodic', 8, undefined, 'Periodic (8 hours retention)'],
        [undefined, undefined, undefined, 'Unknown'],
    ] as const)(
        'summarizes backup configuration without duplicate detail rows (%s, %s, %s)',
        (backupPolicyType, backupRetentionHours, backupIntervalMinutes, expected) => {
            const overview = overviewState();
            render(
                <OverviewHeader
                    overview={{
                        ...overview,
                        summary: {
                            ...overview.summary!,
                            backupPolicyType,
                            backupRetentionHours,
                            backupIntervalMinutes,
                        },
                    }}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Account details' }));
            fireEvent.click(screen.getByText('Additional account properties'));
            const backupField = screen.getByText('Backup policy').parentElement;
            expect(backupField).toHaveTextContent(`Backup policy${expected}`);
            expect(backupField).toBeVisible();
            expect(screen.queryByText('Backup retention')).not.toBeInTheDocument();
            expect(screen.queryByText('Backup interval')).not.toBeInTheDocument();
            expect(screen.queryByText('Total throughput limit')).not.toBeInTheDocument();
            expect(screen.getByText('Total throughput limit: 4,000 RU/s')).toBeVisible();
            expect(screen.getByText('API type')).toBeVisible();
            expect(screen.getByText('Consistency')).toBeVisible();
            expect(screen.getByText('Automatic failover')).toBeVisible();
        },
    );

    it.each([
        [false, 'Opted out'],
        [true, 'Enabled'],
    ] as const)('uses the Original Free tier label for enabled=%s', (freeTierEnabled, label) => {
        const overview = overviewState();
        render(<OverviewHeader overview={{ ...overview, summary: { ...overview.summary!, freeTierEnabled } }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Account details' }));
        const field = screen.getByText('Free tier');
        expect(field).toBeVisible();
        expect(field.parentElement).toHaveTextContent(`Free tier${label}`);
    });

    it.each([
        ['Succeeded', 'Online', 'success'],
        ['Creating', 'Creating', 'warning'],
        ['Updating', 'Updating', 'warning'],
        ['Deleting', 'Deleting', 'warning'],
        ['Failed', 'Failed', 'danger'],
        ['Canceled', 'Canceled', 'warning'],
        [undefined, 'Unknown', 'neutral'],
    ] as const)('displays provisioning state %s as a %s status pill', (provisioningState, label, tone) => {
        const overview = overviewState();
        render(
            <OverviewHeader
                overview={{
                    ...overview,
                    summary: { ...overview.summary!, provisioningState },
                }}
            />,
        );
        const pill = screen.getByText(label, { selector: 'span' });
        expect(pill).toBeVisible();
        expect(screen.getByText('Status:').parentElement).toContainElement(pill);
        expect(pill.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
        expect(DashboardChrome.Pill).toHaveBeenLastCalledWith(expect.objectContaining({ tone }), undefined);
        expect(screen.queryByText(/^Provisioning:/)).not.toBeInTheDocument();
    });

    it('passes the requested chart to details and resets it for generic metric navigation', () => {
        const overview = overviewState();
        render(<AccountOverviewV2 overview={overview} analytics={{ loading: false, failed: false }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Inspect latency' }));
        expect(OverviewDetails).toHaveBeenLastCalledWith(
            expect.objectContaining({ section: 'metrics', initialMetric: 'serverLatency', overview }),
            undefined,
        );
        expect(screen.getByRole('heading', { name: 'Metrics' })).toHaveFocus();
        expect(screen.getByRole('heading', { name: 'Server-side latency trend' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Back to summary' }));
        fireEvent.click(screen.getByRole('button', { name: 'Metrics' }));
        expect(OverviewDetails).toHaveBeenLastCalledWith(
            expect.objectContaining({ section: 'metrics', initialMetric: undefined, overview }),
            undefined,
        );
        expect(screen.getByRole('heading', { name: 'Normalized RU trend' })).toBeVisible();
    });

    it('separates the four status fields with decorative dividers', () => {
        render(<OverviewHeader overview={overviewState()} />);
        const separators = screen.getAllByText('|');
        expect(separators).toHaveLength(3);
        for (const separator of separators) {
            expect(separator).toBeVisible();
            expect(separator).toHaveAttribute('aria-hidden', 'true');
        }
    });

    it('keeps metric controls accessible and account metadata initially collapsed', () => {
        const overview = overviewState();
        render(<OverviewHeader overview={overview} />);
        const allDatabases = screen.getByRole('option', { name: 'All Databases', selected: true });
        expect(allDatabases).toHaveTextContent('All Databases');
        expect(allDatabases).toHaveAccessibleName('All Databases');
        expect(screen.getByRole('heading', { level: 1, name: 'test-account' })).toBeVisible();
        fireEvent.change(screen.getByRole('combobox', { name: 'Metric time range' }), { target: { value: '7D' } });
        expect(overview.setTimeRange).toHaveBeenCalledWith('7D');
        fireEvent.change(screen.getByRole('combobox', { name: 'Metric scope' }), { target: { value: '0' } });
        expect(overview.setSelectedContainer).toHaveBeenCalledWith({ databaseId: 'database', containerId: undefined });
        fireEvent.change(screen.getByRole('combobox', { name: 'Metric scope' }), { target: { value: '-1' } });
        expect(overview.setSelectedContainer).toHaveBeenLastCalledWith(undefined);
        const refresh = screen.getByRole('button', { name: 'Refresh' });
        expect(refresh).toHaveTextContent('Refresh');
        expect(refresh).toHaveAccessibleName('Refresh');
        fireEvent.click(refresh);
        expect(overview.refresh).toHaveBeenCalledOnce();
        const details = screen.getByRole('button', { name: 'Account details' });
        expect(details).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByRole('switch')).not.toBeVisible();
        fireEvent.click(details);
        expect(details).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('test-group')).toBeVisible();
        expect(screen.getByRole('switch')).not.toBeVisible();
        const region = screen.getByRole('region', { name: 'Account details' });
        expect(region).not.toHaveTextContent('Refreshed');
        expect(region).not.toHaveTextContent('Pause auto-refresh');
        for (const [name, action] of [
            ['View cost', 'openCosts'],
            ['JSON view', 'openJson'],
        ]) {
            const button = screen.getByRole('button', { name });
            expect(region).toContainElement(button);
            fireEvent.click(button);
            expect(overview.runAccountAction).toHaveBeenLastCalledWith({ action });
        }
        fireEvent.click(screen.getByText('Refresh options'));
        fireEvent.click(screen.getByRole('switch', { name: 'Pause auto-refresh' }));
        expect(overview.setPaused).toHaveBeenCalledWith(true);
    });

    it('shows an all-regions indicator only for multiple distinct read/write regions', () => {
        const overview = overviewState();
        const { rerender } = render(<OverviewHeader overview={overview} />);
        expect(screen.getByText('All regions')).toBeVisible();
        expect(screen.queryByRole('combobox', { name: /region/i })).not.toBeInTheDocument();

        const summary = overview.summary!;
        rerender(
            <OverviewHeader
                overview={{ ...overview, summary: { ...summary, readRegions: ['East US'], writeRegions: ['East US'] } }}
            />,
        );
        expect(screen.queryByText('All regions')).not.toBeInTheDocument();

        rerender(
            <OverviewHeader overview={{ ...overview, summary: { ...summary, readRegions: [], writeRegions: [] } }} />,
        );
        expect(screen.queryByText('All regions')).not.toBeInTheDocument();

        rerender(
            <OverviewHeader
                overview={{
                    ...overview,
                    summary: { ...summary, readRegions: [], writeRegions: ['East US', 'West US'] },
                }}
            />,
        );
        expect(screen.getByText('All regions')).toBeVisible();
    });

    it('retains supported account actions and the selected database prerequisite', () => {
        const overview = overviewState();
        const { rerender } = render(<OverviewActions overview={overview} />);
        const addContainer = screen.getByRole('button', { name: 'Add container' });
        expect(addContainer).toBeDisabled();
        expect(addContainer).toHaveAccessibleDescription('Select a database using Metric scope to add a container.');
        for (const [name, action] of [
            ['Add database', 'createDatabase'],
            ['Delete account', 'deleteAccount'],
        ]) {
            const button = screen.getByRole('button', { name });
            expect(button).toHaveTextContent(name);
            expect(button).toHaveAccessibleName(name);
            fireEvent.click(button);
            expect(overview.runAccountAction).toHaveBeenLastCalledWith({ action });
        }
        rerender(<OverviewActions overview={{ ...overview, selectedContainer: { databaseId: 'database' } }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add container' }));
        expect(overview.runAccountAction).toHaveBeenLastCalledWith({
            action: 'createContainer',
            databaseId: 'database',
        });
        expect(screen.queryByRole('button', { name: 'View cost' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'JSON view' })).not.toBeInTheDocument();
    });

    it('shows the Data Modeler placeholder with a hover and keyboard explanation without invoking actions', () => {
        vi.useFakeTimers();
        const overview = overviewState();
        render(<OverviewActions overview={overview} />);
        expect(screen.getByText('Design containers, partition keys, and relationships visually.')).toBeVisible();
        const modeler = screen.getByRole('button', { name: 'Try Data Modeler' });
        expect(modeler).toHaveTextContent('Try Data Modeler');
        expect(modeler).toHaveAccessibleName('Try Data Modeler');
        expect(modeler).toHaveAttribute('aria-disabled', 'true');
        expect(modeler).not.toBeDisabled();
        expect(modeler).toHaveAccessibleDescription('Data Modeler is not implemented yet.');
        fireEvent.pointerEnter(modeler);
        act(() => vi.advanceTimersByTime(300));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Data Modeler is not implemented yet.');
        fireEvent.pointerLeave(modeler);
        act(() => vi.advanceTimersByTime(300));
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        fireEvent.focus(modeler);
        act(() => vi.advanceTimersByTime(300));
        expect(screen.getByRole('tooltip')).toHaveTextContent('Data Modeler is not implemented yet.');
        fireEvent.click(modeler);
        fireEvent.keyDown(modeler, { key: 'Enter' });
        fireEvent.keyUp(modeler, { key: 'Enter' });
        fireEvent.keyDown(modeler, { key: ' ' });
        fireEvent.keyUp(modeler, { key: ' ' });
        expect(overview.runAccountAction).not.toHaveBeenCalled();
        expect(overview.actions.openUrl).not.toHaveBeenCalled();
        expect(overview.handleOpenUrl).not.toHaveBeenCalled();
    });

    it('hides action progress text while keeping busy actions disabled and failures visible', () => {
        const overview = overviewState();
        const { rerender } = render(
            <OverviewActions
                overview={{ ...overview, accountActionBusy: true, selectedContainer: { databaseId: 'database' } }}
            />,
        );
        expect(screen.queryByText(/Account action in progress/)).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        for (const name of ['Add database', 'Add container', 'Delete account']) {
            const button = screen.getByRole('button', { name });
            expect(button).toBeDisabled();
            fireEvent.click(button);
        }
        expect(overview.runAccountAction).not.toHaveBeenCalled();
        rerender(<OverviewActions overview={{ ...overview, accountActionFailed: true }} />);
        expect(screen.getByRole('alert')).toHaveTextContent('The account action could not be completed.');
    });

    it('keeps health summary evidence compact without inline disclosures', () => {
        const overview = overviewState();
        const { container } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.queryByText(/diagnostic coverage/i)).not.toBeInTheDocument();
        expect(container.querySelector('details')).toBeNull();
        expect(screen.getByRole('table')).toBeVisible();
        expect(screen.queryByText('Threshold 90%')).not.toBeInTheDocument();
    });

    it.each([
        ['View all alerts', 'Account health'],
        ['View all recommendations', 'Recommendations'],
    ])('opens %s over the summary and restores focus after closing', async (label, title) => {
        const user = userEvent.setup();
        render(<AccountOverviewV2 overview={overviewState()} analytics={{ loading: false, failed: false }} />);
        const trigger = screen.getByRole('button', { name: label });
        expect(trigger).toHaveTextContent(label);
        expect(trigger).toHaveAccessibleName(label);
        await user.click(trigger);
        const dialog = screen.getByRole('dialog', { name: title });
        expect(dialog).toBeVisible();
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        expect(screen.getByText('Inspect latency')).toBeInTheDocument();
        expect(within(dialog).queryByText('Derived Advisories')).not.toBeInTheDocument();
        const close = within(dialog).getByRole('button', { name: 'Close' });
        close.focus();
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
        await user.click(close);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
        expect(screen.getByRole('heading', { name: 'Account health' })).toBeVisible();
    });

    it('retains alert-window controls and closes the health dialog with Escape', async () => {
        const user = userEvent.setup();
        const overview = overviewState();
        render(<AccountOverviewV2 overview={overview} analytics={{ loading: false, failed: false }} />);
        const trigger = screen.getByRole('button', { name: 'View all alerts' });
        await user.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Account health' });
        expect(within(dialog).getByText('Threshold 90%')).toBeVisible();
        const windows = within(dialog).getByRole('group', { name: 'Azure alert window' });
        expect(within(windows).getByRole('button', { name: '1d' })).toHaveAttribute('aria-pressed', 'true');
        await user.click(within(windows).getByRole('button', { name: '7d' }));
        expect(overview.setAlertTimeRange).toHaveBeenCalledWith('7d');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('opens the dedicated RU dialog, traps focus and returns to the trigger with Escape or Close', async () => {
        const user = userEvent.setup();
        render(<AccountOverviewV2 overview={overviewState()} analytics={{ loading: false, failed: false }} />);
        const trigger = screen.getByRole('button', { name: 'View RU consumption details' });
        await user.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'Normalized RU Consumption' });
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
        expect(within(dialog).getByRole('heading', { name: 'Consumption over time' })).toBeVisible();
        expect(within(dialog).getByRole('heading', { name: 'Highest-utilization ranges' })).toBeVisible();
        const review = within(dialog).getByRole('button', { name: 'Review hot partitions' });
        expect(review).toHaveTextContent('Review hot partitions');
        expect(review).toHaveAccessibleName('Review hot partitions');
        review.focus();
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
        await user.click(trigger);
        await user.click(screen.getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('opens hot-partition diagnostics in RU mode for the metric container and restores summary focus', async () => {
        const user = userEvent.setup();
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'db', containerId: 'products' };
        overview.partitionMode = 'storage';
        render(<AccountOverviewV2 overview={overview} analytics={{ loading: false, failed: false }} />);
        await user.click(screen.getByRole('button', { name: 'View RU consumption details' }));
        await user.click(screen.getByRole('button', { name: 'Review hot partitions' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(overview.setPartitionMode).toHaveBeenCalledWith('ru');
        expect(overview.handleSelectPartitionContainer).toHaveBeenCalledWith(overview.selectedContainer);
        expect(screen.getByRole('heading', { name: 'Partitions' })).toHaveFocus();
        await user.click(screen.getByRole('button', { name: 'Back to summary' }));
        expect(screen.getByRole('main', { name: 'Account overview' })).toHaveFocus();
    });

    it('shows measured RU statistics, scoped guidance, ranked containers and no invented logical keys', () => {
        const overview = overviewState();
        overview.trends.normalizedRu = {
            metric: 'normalizedRu',
            available: true,
            timeRange: '24H',
            generatedAt: 86_400_000,
            points: [
                { timestamp: 0, value: 100 },
                { timestamp: 300_000, value: 81 },
            ],
        };
        overview.inventoryMetrics = {
            available: true,
            timeRange: '24H',
            generatedAt: 86_400_000,
            accountHealth: 'Healthy',
            metrics: {
                'db/events': {
                    databaseId: 'db',
                    containerId: 'events',
                    peakRuPercent: 60,
                    throttled: false,
                    health: 'Healthy',
                },
                'db/products': {
                    databaseId: 'db',
                    containerId: 'products',
                    peakRuPercent: 96,
                    throttled: false,
                    health: 'Healthy',
                },
            },
        };
        const analytics = {
            loading: false,
            failed: false,
            data: {
                timeRange: '24H' as const,
                generatedAt: 86_400_000,
                windowStart: 0,
                windowEnd: 86_400_000,
                throttling: { available: true, ratePercent: 1.8, totalRequests: 1000, throttledRequests: 18 },
                consumedRu: { available: false, bucketSeconds: 300 },
                resources: {},
                resourcesComplete: true,
            },
        };
        render(<AccountOverviewV2 overview={overview} analytics={analytics} />);
        fireEvent.click(screen.getByRole('button', { name: 'View RU consumption details' }));
        const dialog = screen.getByRole('dialog', { name: 'Normalized RU Consumption' });
        expect(within(dialog).getByText('Current').parentElement).toHaveTextContent('81%');
        expect(within(dialog).getByText('24-hour peak').parentElement).toHaveTextContent('100%');
        expect(within(dialog).getByText('Time above 80% (estimated)').parentElement).toHaveTextContent('10m');
        expect(within(dialog).getByText('429 throttling').parentElement).toHaveTextContent('1.8%');
        const rows = within(within(dialog).getByRole('table', { name: 'Highest-utilization containers' })).getAllByRole(
            'row',
        );
        expect(rows[1]).toHaveTextContent('db / products96%Unavailable');
        expect(rows[2]).toHaveTextContent('db / events60%Unavailable');
        expect(
            within(dialog).getByText(/Logical partition-key values and per-key 429 rates are not available/),
        ).toBeVisible();
        expect(within(dialog).queryByText(/user_id=892/)).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/indicates saturation with headroom/)).not.toBeInTheDocument();
    });

    it('does not show old metric values after the scope changes', () => {
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'db', containerId: 'products' };
        overview.trends.normalizedRu = {
            metric: 'normalizedRu',
            available: true,
            timeRange: '24H',
            generatedAt: 86_400_000,
            points: [{ timestamp: 0, value: 81 }],
        };
        render(<AccountOverviewV2 overview={overview} analytics={{ loading: false, failed: false }} />);
        fireEvent.click(screen.getByRole('button', { name: 'View RU consumption details' }));
        const dialog = screen.getByRole('dialog', { name: 'Normalized RU Consumption' });
        expect(within(dialog).getByText('Current').parentElement).not.toHaveTextContent('81%');
        expect(within(dialog).getByText('Time above 80% (estimated)').parentElement).toHaveTextContent('Unavailable');
        expect(
            within(dialog).queryByRole('group', { name: 'Normalized RU consumption chart' }),
        ).not.toBeInTheDocument();
    });
});
