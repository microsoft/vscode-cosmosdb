/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { AccountOverviewV2 } from './AccountOverviewV2';
import { OverviewActions } from './OverviewActions';
import { OverviewDetails } from './OverviewDetails';
import { OverviewFindings } from './OverviewFindings';
import { type OverviewSummaryProps } from './overviewFindingsModel';
import { OverviewHeader } from './OverviewHeader';

vi.mock('./OverviewMetrics', () => ({
    OverviewMetrics: ({ onInspect }: OverviewSummaryProps) => (
        <button onClick={() => onInspect('metrics', 'serverLatency')}>Inspect latency</button>
    ),
}));
vi.mock('./OverviewDetails', async (importOriginal) => {
    const original = await importOriginal<{ OverviewDetails: typeof OverviewDetails }>();
    return {
        detailTitles: { metrics: 'Metrics', inventory: 'Resources', partition: 'Partitions', findings: 'Findings' },
        OverviewDetails: vi.fn((props: Parameters<typeof OverviewDetails>[0]) =>
            props.section === 'metrics' ? <original.OverviewDetails {...props} /> : <div>Detailed evidence</div>,
        ),
    };
});

afterEach(cleanup);

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
        expect(screen.queryByText(/Data Modeler/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'View cost' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'JSON view' })).not.toBeInTheDocument();
    });

    it('keeps incomplete coverage visible while evidence and coverage details are collapsed', () => {
        const overview = overviewState();
        const { container, rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText(/Diagnostic coverage is incomplete/)).toBeVisible();
        const disclosures = container.querySelectorAll('details');
        expect(disclosures).toHaveLength(2);
        for (const disclosure of disclosures) {
            expect(disclosure).not.toHaveAttribute('open');
        }
        expect(screen.getByText('Threshold 90%')).not.toBeVisible();
        fireEvent.click(screen.getByText('Details'));
        expect(screen.getByText('Threshold 90%')).toBeVisible();
        expect(screen.getByText('Review the partition key.')).toBeVisible();
        expect(screen.getByText('Derived finding')).toBeVisible();
        rerender(<OverviewFindings overview={{ ...overview, alertsLoading: true }} onInspect={vi.fn()} />);
        expect(screen.getByText('Updating diagnostic coverage…')).toBeVisible();
    });

    it('focuses detail headings and returns to a visible summary fallback', () => {
        render(<AccountOverviewV2 overview={overviewState()} analytics={{ loading: false, failed: false }} />);
        expect(screen.queryByRole('heading', { name: 'Account summary' })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Preview:/)).not.toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Detailed diagnostics' })).toBeVisible();
        const inspect = screen.getByRole('button', { name: 'Inspect evidence' });
        inspect.focus();
        fireEvent.click(inspect);
        expect(screen.getByRole('heading', { name: 'Findings' })).toHaveFocus();
        fireEvent.click(screen.getByRole('button', { name: 'Back to summary' }));
        expect(screen.getByRole('main', { name: 'Account overview' })).toHaveFocus();
        expect(screen.getByRole('heading', { name: 'Account health' })).toBeVisible();
    });
});
