/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import type * as Recharts from 'recharts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type MetricKey, type MetricSeriesResult } from '../../api/types';
import { OverviewFindings, OverviewRecommendations } from './OverviewFindings';
import { type OverviewSummaryProps } from './overviewFindingsModel';
import { OverviewMetrics } from './OverviewMetrics';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

vi.mock('recharts', async (importOriginal) => ({
    ...(await importOriginal<typeof Recharts>()),
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
        cloneElement(children, { width: 640, height: 280 }),
}));

afterEach(cleanup);

const chartMetrics: MetricKey[] = [
    'normalizedRu',
    'totalRequestUnits',
    'provisionedThroughput',
    'totalRequests',
    'serverLatency',
    'dataIndexUsage',
    'serviceAvailability',
];

function trend(metric: MetricKey): MetricSeriesResult {
    return {
        metric,
        available: true,
        timeRange: '24H',
        generatedAt: 600_000,
        peak: 25,
        points: [
            { timestamp: 0, value: 5 },
            { timestamp: 300_000, value: 25 },
            { timestamp: 600_000, value: 10 },
        ],
    };
}

function overviewState(): OverviewSummaryProps['overview'] {
    return {
        summary: undefined,
        inventory: undefined,
        inventoryMetrics: undefined,
        accountHealth: undefined,
        containers: [],
        selectedContainer: undefined,
        partitionContainer: undefined,
        partitionHealth: undefined,
        paused: false,
        lastRefreshedAt: 1,
        autoRefreshIntervalsSeconds: { metrics: 60, inventory: 30, alerts: 60 },
        setTimeRange: vi.fn(),
        setSelectedContainer: vi.fn(),
        setPartitionMode: vi.fn(),
        setAlertTimeRange: vi.fn(),
        setPaused: vi.fn(),
        refresh: vi.fn(),
        reloadInventory: vi.fn(async () => {}),
        runAccountAction: vi.fn(async () => {}),
        accountActionBusy: false,
        accountActionFailed: false,
        actions: { reportEvent: vi.fn(), openUrl: vi.fn() },
        trends: {},
        trendsLoading: false,
        timeRange: '24H',
        alertTimeRange: '1d',
        refreshVersion: 0,
        alertsLoading: false,
        recommendationsLoading: false,
        derivedLoading: false,
        partitionLoading: false,
        partitionMode: 'ru',
        dismissedAdvisoryIds: new Set(),
        alerts: {
            available: false,
            reason: 'rbac',
            alerts: [],
            criticalCount: 0,
            warningCount: 0,
            timeRange: '1d',
            generatedAt: 1,
        },
        recommendations: { available: true, recommendations: [], hasHighImpactPerfCost: false, generatedAt: 1 },
        derivedAdvisories: {
            available: true,
            generatedAt: 1,
            logSource: { available: false, reason: 'logAnalyticsDisabled' },
            advisories: [
                {
                    id: 'hot',
                    title: 'Hot partition',
                    rule: 'HotPartitionRisk',
                    severity: 'High',
                    scope: 'database/container',
                    rationale: 'Saturation with headroom elsewhere.',
                    suggestedAction: 'Review the partition key.',
                    thresholdReference: 'Threshold 90%',
                },
            ],
        },
        handleDismissAdvisory: vi.fn(),
        handleOpenUrl: vi.fn(),
        handleOpenQueryEditor: vi.fn(),
        handleRevealInTree: vi.fn(),
        handleSelectPartitionContainer: vi.fn(),
    };
}

function resourceAnalytics(): OverviewAnalyticsState {
    return {
        loading: false,
        failed: false,
        data: {
            timeRange: '24H',
            databaseId: 'database',
            generatedAt: 86_400_000,
            windowStart: 0,
            windowEnd: 86_400_000,
            resourcesComplete: false,
            resourcesReason: 'noData',
            consumedRu: { available: true, peakBucketAverageRuPerSecond: 100, bucketSeconds: 300 },
            throttling: { available: true, ratePercent: 2, totalRequests: 100, throttledRequests: 2 },
            resources: {
                'database/low': {
                    databaseId: 'database',
                    containerId: 'low',
                    consumedRu: { available: true, peakBucketAverageRuPerSecond: 10, bucketSeconds: 300 },
                    throttling: { available: false, totalRequests: 0, throttledRequests: 0 },
                },
                'database/high': {
                    databaseId: 'database',
                    containerId: 'high',
                    consumedRu: { available: true, peakBucketAverageRuPerSecond: 100, bucketSeconds: 300 },
                    throttling: { available: true, ratePercent: 2, totalRequests: 100, throttledRequests: 2 },
                },
            },
        },
    };
}

describe('standalone overview summaries', () => {
    it.each([
        ['Inspect requests', 'totalRequests'],
        ['Inspect latency', 'serverLatency'],
        ['Inspect availability', 'serviceAvailability'],
    ] as const)('opens the relevant metric from %s', (label, metric) => {
        const onInspect = vi.fn();
        render(<OverviewMetrics overview={overviewState()} onInspect={onInspect} />);
        const button = screen.getByRole('button', { name: label });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        fireEvent.click(button);
        expect(onInspect).toHaveBeenCalledExactlyOnceWith('metrics', metric);
    });

    it('matches the mockup hierarchy with three throughput cards, one sparkline and four lower cards', () => {
        const overview = overviewState();
        overview.trends = Object.fromEntries(chartMetrics.map((key) => [key, trend(key)]));
        const onInspect = vi.fn();
        const { container } = render(<OverviewMetrics overview={overview} onInspect={onInspect} />);
        expect(screen.getAllByRole('figure')).toHaveLength(1);
        expect(screen.getByRole('figure', { name: 'Normalized RU trend' })).toHaveStyle({ height: '64px' });
        expect(container.querySelectorAll('path.recharts-line-curve')).toHaveLength(1);
        expect(within(screen.getByRole('region', { name: 'Throughput health' })).getAllByRole('article')).toHaveLength(
            3,
        );
        for (const name of ['Latency and queries', 'Storage and index', 'Availability and resilience']) {
            expect(within(screen.getByRole('region', { name })).queryByRole('figure')).not.toBeInTheDocument();
        }
        expect(onInspect).not.toHaveBeenCalled();
    });

    it('does not draw stale or loading trends under a new scope or time window', () => {
        const overview = overviewState();
        overview.trends = { normalizedRu: trend('normalizedRu') };
        const { rerender } = render(<OverviewMetrics overview={overview} onInspect={vi.fn()} />);
        expect(screen.getAllByRole('figure')).toHaveLength(1);
        for (const change of [
            { selectedContainer: { databaseId: 'other' } },
            { timeRange: '7D' as const },
            { trendsLoading: true },
            { trends: { normalizedRu: trend('totalRequests') } },
        ]) {
            rerender(<OverviewMetrics overview={{ ...overview, ...change }} onInspect={vi.fn()} />);
            expect(screen.queryByRole('figure')).not.toBeInTheDocument();
        }
        const scoped = { ...trend('normalizedRu'), databaseId: 'other', timeRange: '7D' as const };
        rerender(
            <OverviewMetrics
                overview={{
                    ...overview,
                    selectedContainer: { databaseId: 'other' },
                    timeRange: '7D',
                    trends: { normalizedRu: scoped },
                }}
                onInspect={vi.fn()}
            />,
        );
        expect(screen.getAllByRole('figure')).toHaveLength(1);
    });

    it('keeps missing samples as visible gaps and renders a lone measured sample as a dot', () => {
        const overview = overviewState();
        const series = trend('normalizedRu');
        series.points = [
            { timestamp: 0, value: 5 },
            { timestamp: 300_000, value: 10 },
            { timestamp: 600_000, value: undefined },
            { timestamp: 900_000, value: 15 },
            { timestamp: 1_200_000, value: 20 },
        ];
        overview.trends = { normalizedRu: series };
        const { container, rerender } = render(<OverviewMetrics overview={overview} onInspect={vi.fn()} />);
        const path = container.querySelector('path.recharts-line-curve')?.getAttribute('d');
        expect(path?.match(/M/g)).toHaveLength(2);
        rerender(
            <OverviewMetrics
                overview={{
                    ...overview,
                    trends: { normalizedRu: { ...series, points: [{ timestamp: 0, value: 0 }] } },
                }}
                onInspect={vi.fn()}
            />,
        );
        expect(container.querySelector('circle.recharts-line-dot')).toBeInTheDocument();
        rerender(
            <OverviewMetrics
                overview={{
                    ...overview,
                    trends: {
                        normalizedRu: {
                            ...series,
                            points: [
                                { timestamp: 0, value: 5 },
                                { timestamp: 300_000, value: undefined },
                                { timestamp: 600_000, value: 10 },
                            ],
                        },
                    },
                }}
                onInspect={vi.fn()}
            />,
        );
        expect(container.querySelectorAll('circle.recharts-line-dot')).toHaveLength(2);
    });

    it('does not invent charts for unavailable or invalid measurements', () => {
        const overview = overviewState();
        overview.trends = {
            normalizedRu: { ...trend('normalizedRu'), points: [{ timestamp: 0, value: Number.NaN }] },
            totalRequests: { ...trend('totalRequests'), available: false, reason: 'rbac' },
            serverLatency: { ...trend('serverLatency'), points: [] },
        };
        render(<OverviewMetrics overview={overview} onInspect={vi.fn()} />);
        expect(screen.queryByRole('figure')).not.toBeInTheDocument();
        expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
    });

    it('draws partition saturation bars only for the matching snapshot and labels their actual values', () => {
        const overview = overviewState();
        overview.partitionContainer = { databaseId: 'database', containerId: 'container' };
        overview.partitionHealth = {
            ...overview.partitionContainer,
            available: true,
            timeRange: '24H',
            mode: 'ru',
            generatedAt: 1,
            partitionCount: 2,
            topN: 2,
            skewScore: 60,
            topPartitionShare: 60,
            maxSaturationPercent: 60,
            tiles: [
                { partitionId: '0', sharePercent: 60, level: 3, hot: false },
                { partitionId: '1', sharePercent: 20, level: 1, hot: false },
            ],
        };
        const { rerender } = render(<OverviewMetrics overview={overview} onInspect={vi.fn()} />);
        const region = screen.getByRole('region', { name: 'Partition skew' });
        expect(within(region).getByText('PKR-0 — 60%')).toBeInTheDocument();
        expect(within(region).getByText('PKR-1 — 20%')).toBeInTheDocument();
        expect(region.querySelector('[style="height: 60%;"]')).toBeInTheDocument();
        expect(region.querySelector('[style="height: 20%;"]')).toBeInTheDocument();
        expect(within(region).getByRole('img')).toHaveAccessibleName('PKR-0: 60%; PKR-1: 20%');
        rerender(<OverviewMetrics overview={{ ...overview, timeRange: '7D' }} onInspect={vi.fn()} />);
        expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    });

    it('renders truthful provenance, reason-specific coverage and native accessible action names', () => {
        const overview = overviewState();
        const onInspect = vi.fn();
        render(<OverviewFindings overview={overview} onInspect={onInspect} />);
        expect(screen.getByText('Derived finding')).toBeInTheDocument();
        expect(screen.getByText('Saturation with headroom elsewhere.')).toBeInTheDocument();
        expect(screen.getByText(/Azure Monitor alerts.*permission/)).toBeInTheDocument();
        expect(screen.getByText(/Partial coverage.*Diagnostic settings/)).toBeInTheDocument();
        expect(screen.queryByText(/^Healthy$/)).not.toBeInTheDocument();
        const inspect = screen.getByRole('button', { name: 'View all findings' });
        expect(inspect).toHaveAccessibleName(inspect.textContent);
        fireEvent.click(inspect);
        expect(onInspect).toHaveBeenCalledWith('findings');
    });

    it('dismisses through shared state and moves focus to a surviving action', () => {
        const overview = overviewState();
        const { rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        const dismiss = screen.getByRole('button', { name: 'Dismiss' });
        expect(dismiss).toHaveAccessibleDescription('Dismiss Hot partition for this session only.');
        dismiss.focus();
        fireEvent.click(dismiss);
        expect(overview.handleDismissAdvisory).toHaveBeenCalledWith('hot');
        expect(screen.getByRole('button', { name: 'View all findings' })).toHaveFocus();
        rerender(
            <OverviewFindings overview={{ ...overview, dismissedAdvisoryIds: new Set(['hot']) }} onInspect={vi.fn()} />,
        );
        expect(screen.queryByRole('heading', { name: 'Hot partition' })).not.toBeInTheDocument();
    });

    it('preserves full findings navigation when only the highest-ranked cards are shown', () => {
        const overview = overviewState();
        const item = overview.derivedAdvisories!.advisories[0];
        overview.derivedAdvisories!.advisories = Array.from({ length: 8 }, (_, index) => ({
            ...item,
            id: `${index}`,
            title: `Issue ${index}`,
        }));
        render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
        expect(screen.getByText('Showing 3 of 8 health findings.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View all findings' })).toBeEnabled();
    });

    it('exports recommendations separately for composition below metrics', () => {
        const overview = overviewState();
        overview.recommendations!.recommendations = [
            {
                id: 'cost',
                category: 'Cost',
                impact: 'High',
                problem: 'Review provisioned capacity',
                solution: 'Inspect usage.',
            },
        ];
        const onInspect = vi.fn();
        render(<OverviewRecommendations overview={overview} onInspect={onInspect} />);
        expect(screen.getByRole('heading', { name: 'Prioritized recommendations' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Account health' })).not.toBeInTheDocument();
        expect(screen.getByText('Review provisioned capacity')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'View all recommendations' }));
        expect(onInspect).toHaveBeenCalledWith('findings');
    });

    it('renders all metric categories and routes each drill-down without fabricating missing values', () => {
        const onInspect = vi.fn();
        render(<OverviewMetrics overview={overviewState()} onInspect={onInspect} />);
        for (const title of [
            'Throughput health',
            'Top resources by peak normalized RU',
            'Latency and queries',
            'Partition skew',
            'Storage and index',
            'Availability and resilience',
        ]) {
            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
        }
        const partitions = screen.getByRole('region', { name: 'Partition skew' });
        expect(within(partitions).getByText(/Select a container in partition details/)).toBeInTheDocument();
        for (const [label, section] of [
            ['Inspect full metrics', 'metrics'],
            ['View complete inventory', 'inventory'],
            ['Inspect partition distribution', 'partition'],
        ]) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toHaveAccessibleName(button.textContent);
            fireEvent.click(button);
            expect(onInspect).toHaveBeenLastCalledWith(section);
        }
        expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Healthy$/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Query diagnostics · incomplete coverage'));
        fireEvent.click(screen.getByRole('button', { name: 'Inspect query findings' }));
        expect(onInspect).toHaveBeenLastCalledWith('findings');
    });

    it('shows measured analytics in separate rate and capacity cards', () => {
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'database' };
        render(<OverviewMetrics overview={overview} onInspect={vi.fn()} analytics={resourceAnalytics()} />);
        const throughput = screen.getByRole('region', { name: 'Throughput health' });
        expect(within(throughput).getByRole('article', { name: '429 throttling rate' })).toBeInTheDocument();
        expect(within(throughput).getByText('2%')).toBeInTheDocument();
        expect(within(throughput).getByText('100 RU/s')).toBeInTheDocument();
    });

    it('shows scoped consumed ranking, partial coverage and exact-resource actions', () => {
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'database' };
        const onInspect = vi.fn();
        render(<OverviewMetrics overview={overview} onInspect={onInspect} analytics={resourceAnalytics()} />);
        const region = screen.getByRole('region', { name: 'Top RU consumers' });
        const rows = within(region).getAllByRole('row').slice(1);
        expect(within(rows[0]).getByText('database / high')).toBeInTheDocument();
        expect(within(rows[0]).getByText('100 RU/s')).toBeInTheDocument();
        expect(within(rows[0]).getByText('2%')).toBeInTheDocument();
        expect(within(rows[1]).getByText('No measured requests; a 429 rate is undefined.')).toBeInTheDocument();
        expect(within(region).getByText(/Database database.*24H.*ranked by peak bucket-average/)).toBeInTheDocument();
        expect(within(region).queryByText(/Account-wide/)).not.toBeInTheDocument();
        expect(within(region).getByText(/Incomplete resource-split coverage/)).toBeInTheDocument();
        fireEvent.click(within(rows[0]).getByText('Resource details'));
        const query = within(rows[0]).getByRole('button', { name: 'Open query editor' });
        expect(query).toHaveAccessibleName(query.textContent);
        expect(query).toHaveAccessibleDescription('Container: database / high');
        fireEvent.click(query);
        expect(overview.handleOpenQueryEditor).toHaveBeenCalledWith('database', 'high');
        fireEvent.click(within(rows[0]).getByRole('button', { name: 'Reveal in tree' }));
        expect(overview.handleRevealInTree).toHaveBeenCalledWith('database', 'high');
        fireEvent.click(within(rows[0]).getByRole('button', { name: 'Inspect partitions' }));
        expect(overview.handleSelectPartitionContainer).toHaveBeenCalledWith({
            databaseId: 'database',
            containerId: 'high',
        });
        expect(onInspect).toHaveBeenLastCalledWith('partition');
    });

    it('keeps table measurement notes behind the heading info button, not below the table', () => {
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'database' };
        render(<OverviewMetrics overview={overview} onInspect={vi.fn()} analytics={resourceAnalytics()} />);
        const region = screen.getByRole('region', { name: 'Top RU consumers' });
        expect(within(region).queryByText(/measurement details/i)).not.toBeInTheDocument();
        expect(within(region).getByText(/Incomplete resource-split coverage/)).toBeVisible();
        const info = within(region).getByRole('button', { name: 'Resource measurement information' });
        expect(info.parentElement).toContainElement(within(region).getByRole('heading'));
        expect(screen.queryByText(/Resource peaks can occur at different times/)).not.toBeInTheDocument();
        fireEvent.click(info);
        const notes = screen.getByRole('group', { name: 'Resource measurement information' });
        expect(within(notes).getByText(/Resource peaks can occur at different times/)).toBeVisible();
        expect(within(notes).getByText(/Showing 2 of 2/)).toBeVisible();
    });

    it('shows the five inventory containers with canonical actions instead of an empty-dimension resource', () => {
        const overview = overviewState();
        overview.inventory = {
            supported: true,
            available: true,
            databases: ['bugbash', 'Test'],
            rows: [
                ['bugbash', 'order'],
                ['bugbash', 'products'],
                ['bugbash', 'test'],
                ['Test', 'Large'],
                ['Test', 'Test'],
            ].map(([databaseId, containerId]) => ({
                databaseId,
                containerId,
                throughputMode: 'dedicated',
                partitionKeyPaths: ['/id'],
                indexingMode: 'consistent',
                excludedPathCount: 0,
                compositeIndexCount: 0,
                health: 'Healthy',
            })),
        };
        const analytics = resourceAnalytics();
        analytics.data!.databaseId = undefined;
        analytics.data!.resources = Object.fromEntries(
            [
                ['<empty>', '<empty>'],
                ['bugbash', 'order'],
                ['bugbash', 'products'],
                ['bugbash', 'test'],
                ['test', 'test'],
            ].map(([databaseId, containerId], index) => [
                `${databaseId}/${containerId}`,
                {
                    databaseId,
                    containerId,
                    consumedRu: {
                        available: true,
                        peakBucketAverageRuPerSecond: 0.3 / (index + 1),
                        bucketSeconds: 300,
                    },
                    throttling: { available: false, reason: 'noData' },
                },
            ]),
        );
        const { rerender } = render(<OverviewMetrics overview={overview} onInspect={vi.fn()} analytics={analytics} />);
        const region = screen.getByRole('region', { name: 'Top RU consumers' });
        const rows = within(region).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(5);
        expect(within(region).queryByText(/<empty>/)).not.toBeInTheDocument();
        expect(within(region).getByText(/4 of 5 inventory containers/)).toBeVisible();
        const large = rows[4];
        expect(within(large).getAllByRole('cell')[2]).toHaveTextContent('—');
        fireEvent.click(within(large).getByRole('button', { name: 'Test / Large' }));
        expect(overview.handleOpenQueryEditor).toHaveBeenLastCalledWith('Test', 'Large');
        fireEvent.click(within(rows[3]).getByRole('button', { name: 'Test / Test' }));
        expect(overview.handleOpenQueryEditor).toHaveBeenLastCalledWith('Test', 'Test');
        rerender(
            <OverviewMetrics
                overview={overview}
                onInspect={vi.fn()}
                analytics={{ ...analytics, data: { ...analytics.data!, resources: {} } }}
            />,
        );
        expect(within(region).getAllByRole('row')).toHaveLength(6);
        expect(within(region).getByText(/0 of 5 inventory containers/)).toBeVisible();
    });

    it('shows matching inventory values with seven-day byte labels, but suppresses stale enrichment', () => {
        const overview = overviewState();
        overview.selectedContainer = { databaseId: 'database' };
        overview.inventoryMetrics = {
            available: true,
            accountHealth: 'Healthy',
            generatedAt: 1,
            timeRange: '24H',
            metrics: {
                'database/high': {
                    databaseId: 'database',
                    containerId: 'high',
                    peakRuPercent: 35,
                    storageBytes: 1024,
                    storageGrowthBytes: 512,
                    indexGrowthBytes: -256,
                    health: 'Healthy',
                    throttled: false,
                },
            },
        };
        const { rerender } = render(
            <OverviewMetrics overview={overview} onInspect={vi.fn()} analytics={resourceAnalytics()} />,
        );
        expect(screen.getByText('35%')).toBeInTheDocument();
        expect(screen.getByText('35%').parentElement?.querySelector('[style="width: 35%;"]')).toBeInTheDocument();
        expect(screen.getByText('Seven-day data change: +512 B; index change: −256 B')).toBeInTheDocument();
        rerender(
            <OverviewMetrics
                overview={{
                    ...overview,
                    inventoryMetrics: { ...overview.inventoryMetrics, timeRange: '7D' },
                }}
                onInspect={vi.fn()}
                analytics={resourceAnalytics()}
            />,
        );
        expect(screen.queryByText('35%')).not.toBeInTheDocument();
        expect(screen.queryByText('Seven-day data change: +512 B; index change: −256 B')).not.toBeInTheDocument();
    });
});
