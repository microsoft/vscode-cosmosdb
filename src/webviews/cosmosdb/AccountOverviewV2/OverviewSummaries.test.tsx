/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import type * as FluentUI from '@fluentui/react-components';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement, type ReactElement } from 'react';
import type * as Recharts from 'recharts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DerivedAdvisoryRule, type MetricKey, type MetricSeriesResult } from '../../api/types';
import { OverviewFindingDetails, OverviewFindings, OverviewRecommendations } from './OverviewFindings';
import { derivedFindingPresentation, type OverviewSummaryProps } from './overviewFindingsModel';
import { OverviewMetrics } from './OverviewMetrics';
import { OverviewThroughput } from './OverviewThroughput';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const { announce } = vi.hoisted(() => ({ announce: vi.fn() }));

vi.mock('@fluentui/react-components', async (importOriginal) => ({
    ...(await importOriginal<typeof FluentUI>()),
    useAnnounce: () => ({ announce }),
}));

vi.mock('recharts', async (importOriginal) => ({
    ...(await importOriginal<typeof Recharts>()),
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
        cloneElement(children, { width: 640, height: 280 }),
}));

afterEach(() => {
    cleanup();
    announce.mockClear();
    vi.restoreAllMocks();
});

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

function throughputFixture() {
    const overview = overviewState();
    overview.selectedContainer = { databaseId: 'database' };
    overview.trends = {
        normalizedRu: {
            ...trend('normalizedRu'),
            databaseId: 'database',
            points: [
                { timestamp: 0, value: 100 },
                { timestamp: 600_000, value: 81 },
            ],
        },
        provisionedThroughput: {
            ...trend('provisionedThroughput'),
            databaseId: 'database',
            points: [
                { timestamp: 0, value: 12000 },
                { timestamp: 600_000, value: 4000 },
            ],
        },
    };
    const analytics = resourceAnalytics();
    analytics.data = {
        ...analytics.data!,
        previousWindowStart: -86_400_000,
        previousWindowEnd: 0,
        throttling: { available: true, totalRequests: 1000, throttledRequests: 18, ratePercent: 1.8 },
        previousThrottling: { available: true, totalRequests: 1000, throttledRequests: 12, ratePercent: 1.2 },
        consumedRu: { available: true, peakBucketAverageRuPerSecond: 3240, bucketSeconds: 300 },
        autoscaleMaxThroughput: { available: true, value: 10000, timestamp: 600_000 },
    };
    return { overview, analytics };
}

function populatedHealthFindings(): OverviewSummaryProps['overview'] {
    const overview = overviewState();
    const item = overview.derivedAdvisories!.advisories[0];
    overview.derivedAdvisories!.advisories = (
        [
            'HotPartitionRisk',
            'SustainedThrottlingInRegion',
            'StorageGrowthRisk',
            'StorageSkewRisk',
            'IndexingCostRisk',
            'ExpensiveConsistency',
            'MultiRegionWriteAntipattern',
            'CrossPartitionQuery',
            'ShardKeyMisalignment',
            'UncontrolledIngestion',
            'SharedThroughputStarvation',
            'OverProvisioning',
            'AutoscaleCandidate',
            'IdleContainer',
            'PartitionMergeCandidate',
            'AutoscaleMaxOverProvisioned',
            'AutoscaleToManualCandidate',
            'ServerlessCandidate',
        ] satisfies DerivedAdvisoryRule[]
    ).map((rule, index) => ({
        ...item,
        rule,
        id: `health-${index}`,
        title: `Health issue ${index}`,
    }));
    return overview;
}

function advisorRecommendations(): NonNullable<OverviewSummaryProps['overview']['recommendations']>['recommendations'] {
    return [
        {
            id: 'cost',
            category: 'Cost',
            impact: 'High',
            problem: 'Review provisioned capacity',
            solution: 'Inspect usage.',
            potentialBenefit: 'USD 20',
            learnMoreLink: 'https://learn.microsoft.com/azure/cosmos-db/',
        },
        ...(['Low', 'High', 'Medium'] as const).map((impact, index) => ({
            id: `advisor-${index}`,
            category: 'Performance' as const,
            impact,
            problem: `Azure Advisor recommendation ${index}`,
            solution: `Advisor guidance ${index}`,
        })),
    ];
}

function populatedFindings(): OverviewSummaryProps['overview'] {
    const overview = populatedHealthFindings();
    overview.recommendations!.recommendations = advisorRecommendations();
    return overview;
}

describe('standalone overview summaries', () => {
    it.each([
        ['View RU consumption details', ['metrics', 'normalizedRu']],
        ['View 429 throttling details', ['throttling']],
        ['Inspect latency', ['metrics', 'serverLatency']],
        ['Inspect availability', ['metrics', 'serviceAvailability']],
    ] as const)('opens the relevant details from %s', (label, destination) => {
        const onInspect = vi.fn();
        render(<OverviewMetrics overview={overviewState()} onInspect={onInspect} />);
        const button = screen.getByRole('button', { name: label });
        expect(button).toHaveTextContent(label);
        expect(button).toHaveAccessibleName(label);
        fireEvent.click(button);
        expect(onInspect).toHaveBeenCalledExactlyOnceWith(...destination);
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

    it('renders the throughput reference values, yellow trend, compact dates and exact bottom actions', () => {
        const fixture = throughputFixture();
        const onInspect = vi.fn();
        render(<OverviewThroughput {...fixture} onInspect={onInspect} />);
        const section = screen.getByRole('region', { name: 'Throughput health' });
        const normalized = within(section).getByRole('article', { name: 'Normalized RU Consumption' });
        expect(within(normalized).getByText('81%')).toBeVisible();
        expect(within(normalized).getByText('81%').closest('dd')).toHaveAccessibleDescription(
            expect.stringContaining('Latest reported normalized RU'),
        );
        expect(within(normalized).getByText('Peak 100%')).toBeVisible();
        expect(within(normalized).getByText('Elevated')).toBeVisible();
        expect(within(normalized).queryByText('Critical')).not.toBeInTheDocument();
        expect(normalized.querySelector('path.recharts-line-curve')).toHaveAttribute(
            'stroke',
            'var(--vscode-charts-yellow, var(--vscode-textLink-foreground))',
        );
        expect(within(normalized).getByText('First interval')).toBeVisible();
        expect(within(normalized).getByText('Last interval')).toBeVisible();
        expect(within(normalized).queryByText('Now')).not.toBeInTheDocument();
        expect(within(normalized).queryByText(new Date(600_000).toLocaleString())).not.toBeInTheDocument();
        const rate = within(section).getByRole('article', { name: '429 throttling rate' });
        expect(within(rate).getByText('1.8%')).toBeVisible();
        expect(within(rate).getByText('+0.6 pp')).toHaveAccessibleDescription(
            expect.stringContaining('percentage points'),
        );
        expect(rate.querySelector('[style="width: 36%;"]')).toBeInTheDocument();
        expect(within(rate).getByText('5% investigate')).toBeVisible();
        expect(rate).toHaveTextContent(
            'end-to-end latency is acceptable and requests are evenly distributed across partitions',
        );
        expect(rate).toHaveTextContent('Verify distribution and retry outcomes separately.');
        expect(rate).not.toHaveTextContent('concentrated in one partition');
        const capacity = within(section).getByRole('article', { name: 'Provisioned vs consumed' });
        expect(within(capacity).getByText('3,240')).toBeVisible();
        expect(within(capacity).getByText('3,240 RU/s')).toBeVisible();
        expect(within(capacity).getByText('4,000 RU/s')).toHaveAccessibleDescription(
            expect.stringContaining('not a sum'),
        );
        expect(within(capacity).getByText('10,000 RU/s')).toHaveAccessibleDescription(
            expect.stringContaining('not a sum'),
        );
        expect(section.querySelector('details')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Inspect full metrics' })).not.toBeInTheDocument();
        for (const [label, destination] of [
            ['View RU consumption details', ['metrics', 'normalizedRu']],
            ['View 429 throttling details', ['throttling']],
        ] as const) {
            const button = within(section).getByRole('button', { name: label });
            expect(button).toHaveTextContent(label);
            expect(button).toHaveAccessibleName(label);
            fireEvent.click(button);
            expect(onInspect).toHaveBeenLastCalledWith(...destination);
        }
        const capacityAction = within(section).getByRole('button', { name: 'Review capacity details' });
        expect(capacityAction).toHaveTextContent('Review capacity details');
        expect(capacityAction).toHaveAccessibleName('Review capacity details');
        fireEvent.click(capacityAction);
        expect(onInspect).toHaveBeenLastCalledWith('capacity');
    });

    it('keeps scope, timestamps and measurement caveats in a keyboard-accessible heading popover', async () => {
        const debugStart = performance.now();
        const debug = (step: string) => console.log('[DEBUG-throughput-focus]', step, performance.now() - debugStart);
        const user = userEvent.setup();
        render(
            <FluentProvider theme={webLightTheme}>
                <OverviewThroughput {...throughputFixture()} onInspect={vi.fn()} />
            </FluentProvider>,
        );
        debug('rendered');
        const info = screen.getByRole('button', { name: 'Throughput measurement information' });
        expect(screen.queryByText(/visual attention guide/)).not.toBeInTheDocument();
        info.focus();
        debug('focused');
        await user.keyboard('{Enter}');
        debug('opened');
        const popup = screen.getByRole('group', { name: 'Throughput measurement information' });
        debug('queried');
        expect(popup).toHaveTextContent('Metric scope: Database database · 24H');
        expect(popup).toHaveTextContent(`Latest usable sample: ${new Date(600_000).toLocaleString()}`);
        expect(popup).toHaveTextContent('not a detector or alert threshold');
        expect(popup).toHaveTextContent('not an SLA or an automatic health failure');
        expect(popup).toHaveTextContent('not an instantaneous peak');
        expect(popup).toHaveTextContent('not a sum of allocations or an instantaneous current value');
        expect(popup).toHaveTextContent('not a sum or a configured account limit');
        await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
        debug('focus checked');
        await user.keyboard('{Escape}');
        debug('escaped');
        await waitFor(() =>
            expect(screen.queryByRole('group', { name: 'Throughput measurement information' })).not.toBeInTheDocument(),
        );
        expect(info).toHaveFocus();
    });

    it.each([
        [4.9, '98%'],
        [5, '100%'],
        [12.34567, '100%'],
    ])('caps gauge fill for %s%% without clamping or coarsely rounding the rate', (value, width) => {
        const fixture = throughputFixture();
        fixture.analytics.data!.throttling = {
            available: true,
            totalRequests: 10000000,
            throttledRequests: value * 100000,
            ratePercent: value,
        };
        render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        const rate = screen.getByRole('article', { name: '429 throttling rate' });
        expect(within(rate).getByText(`${value}%`)).toBeVisible();
        const fill = rate.querySelector<HTMLElement>('[aria-hidden="true"] > [style]');
        expect(fill).toBeInTheDocument();
        expect(Number.parseFloat(fill!.style.width)).toBeCloseTo(Number.parseFloat(width));
    });

    it.each([
        [2.4, '−0.6 pp'],
        [1.8, '0 pp'],
    ])('renders prior rate %s as %s', (previous, label) => {
        const fixture = throughputFixture();
        fixture.analytics.data!.previousThrottling = {
            available: true,
            totalRequests: 1000,
            throttledRequests: previous * 10,
            ratePercent: previous,
        };
        render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        expect(screen.getByText(label)).toBeVisible();
    });

    it('uses relative labels only when actual sample times support them', () => {
        const fixture = throughputFixture();
        const now = 1_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        fixture.overview.trends.normalizedRu!.points = [
            { timestamp: now - 86_400_000, value: 100 },
            { timestamp: now, value: 81 },
        ];
        const { rerender } = render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        expect(screen.getByText('24 hours ago')).toBeVisible();
        expect(screen.getByText('Now')).toBeVisible();
        vi.spyOn(Date, 'now').mockReturnValue(now + 300_000);
        rerender(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        expect(screen.queryByText('Now')).not.toBeInTheDocument();
        expect(screen.getByText('Last interval')).toBeVisible();
    });

    it('preserves partial and missing-capacity states without phantom peaks, deltas or autoscale allocations', () => {
        const fixture = throughputFixture();
        fixture.overview.trends.normalizedRu!.points.push({ timestamp: 900_000, value: undefined });
        fixture.analytics.data!.previousThrottling = undefined;
        fixture.analytics.data!.autoscaleMaxThroughput = undefined;
        render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        expect(screen.getByText('81%')).toBeVisible();
        expect(screen.getByText('Partial samples: 2 of 3 returned intervals are usable.')).toBeVisible();
        expect(screen.queryByText(/\bpp$/)).not.toBeInTheDocument();
        const capacity = screen.getByRole('article', { name: 'Provisioned vs consumed' });
        expect(within(capacity).getByText('Unavailable')).toBeVisible();
        expect(within(capacity).queryByText('Not applicable')).not.toBeInTheDocument();
        expect(within(capacity).queryByText('0 RU/s')).not.toBeInTheDocument();
    });

    it('keeps serverless capacity not applicable while still displaying consumed RU', () => {
        const fixture = throughputFixture();
        fixture.overview.summary = {
            accountName: 'account',
            apiType: 'NoSQL',
            resourceGroup: 'group',
            subscriptionName: 'subscription',
            subscriptionId: 'subscription',
            documentEndpoint: 'https://example.documents.azure.com',
            isServerless: true,
            freeTierEnabled: false,
            writeRegions: [],
            readRegions: [],
            writeRegionCount: 0,
            readRegionCount: 0,
            lastRefreshedAt: 1,
        };
        render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        const capacity = screen.getByRole('article', { name: 'Provisioned vs consumed' });
        expect(within(capacity).getAllByText('Not applicable')).toHaveLength(2);
        expect(within(capacity).getByText('3,240')).toBeVisible();
        expect(within(capacity).queryByText('4,000 RU/s')).not.toBeInTheDocument();
        expect(within(capacity).queryByText('10,000 RU/s')).not.toBeInTheDocument();
    });

    it('suppresses previous scope values while loading and announces completion', () => {
        const fixture = throughputFixture();
        const { rerender } = render(<OverviewThroughput {...fixture} onInspect={vi.fn()} />);
        rerender(
            <OverviewThroughput
                {...fixture}
                overview={{ ...fixture.overview, trendsLoading: true }}
                analytics={{ ...fixture.analytics, loading: true }}
                onInspect={vi.fn()}
            />,
        );
        expect(screen.getByRole('region', { name: 'Throughput health' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByRole('figure')).not.toBeInTheDocument();
        expect(screen.queryByText('81%')).not.toBeInTheDocument();
        expect(screen.queryByText('+0.6 pp')).not.toBeInTheDocument();
        expect(screen.queryByText('10,000 RU/s')).not.toBeInTheDocument();
        expect(announce).toHaveBeenCalledWith('Updating throughput health…', { polite: true });
        rerender(
            <OverviewThroughput
                {...fixture}
                overview={{ ...fixture.overview, selectedContainer: { databaseId: 'other' } }}
                onInspect={vi.fn()}
            />,
        );
        expect(screen.queryByRole('figure')).not.toBeInTheDocument();
        expect(screen.queryByText('81%')).not.toBeInTheDocument();
        expect(screen.queryByText('+0.6 pp')).not.toBeInTheDocument();
        expect(screen.queryByText('10,000 RU/s')).not.toBeInTheDocument();
        expect(announce).toHaveBeenCalledWith('Throughput health updated.', { polite: true });
        expect(screen.getByRole('region', { name: 'Throughput health' })).toHaveAttribute('aria-busy', 'false');
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

    it('renders a compact health table with separate scope and impact cells, without detailed provenance', () => {
        const overview = overviewState();
        const onInspect = vi.fn();
        const { container } = render(<OverviewFindings overview={overview} onInspect={onInspect} />);
        expect(screen.getByRole('table', { name: 'Account health' }).tagName).toBe('TABLE');
        expect(screen.getAllByRole('row')).toHaveLength(1);
        expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
        expect(
            screen.getByText('Critical signals and warnings that may affect workload performance'),
        ).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Hot partitions' })).toBeInTheDocument();
        expect(screen.getByText('database/container')).toBeInTheDocument();
        const scope = screen.getByText('Affected resource').closest('td')!;
        const impact = screen.getByText('Estimated impact').closest('td')!;
        expect(scope).not.toBe(impact);
        expect(scope).toHaveTextContent('database/container');
        expect(impact).toHaveTextContent('May reduce hot-partition throttling');
        expect(screen.getByText('Attention required')).toBeInTheDocument();
        expect(screen.getByText('1 active issue · 1 warning')).toBeInTheDocument();
        expect(screen.queryByText('Saturation with headroom elsewhere.')).not.toBeInTheDocument();
        expect(screen.queryByText(/Diagnostic coverage/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Derived finding|Source:|Scope:|Threshold 90%/)).not.toBeInTheDocument();
        expect(container.querySelector('details')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Healthy$/)).not.toBeInTheDocument();
        const inspect = screen.getByRole('button', { name: 'View all alerts' });
        expect(inspect).toHaveAccessibleName(inspect.textContent);
        fireEvent.click(inspect);
        expect(onInspect).toHaveBeenCalledWith('findings');
        const details = screen.getByRole('button', { name: 'View details' });
        expect(details).toHaveTextContent('View details');
        expect(details).toHaveAccessibleDescription('Hot partitions');
        fireEvent.click(details);
        expect(onInspect).toHaveBeenLastCalledWith('findings');
    });

    it('dismisses full detail rows with next-action and table-container focus fallbacks and polite feedback', () => {
        const overview = overviewState();
        overview.derivedAdvisories!.advisories.push({
            ...overview.derivedAdvisories!.advisories[0],
            id: 'next',
            title: 'Next finding',
        });
        const { rerender } = render(<OverviewFindingDetails overview={overview} section="findings" />);
        const [dismiss, next] = screen.getAllByRole('button', { name: 'Dismiss' });
        expect(dismiss).toHaveTextContent('Dismiss');
        expect(dismiss).toHaveAccessibleDescription('Dismiss Hot partition for this session only.');
        dismiss.focus();
        fireEvent.click(dismiss);
        expect(overview.handleDismissAdvisory).toHaveBeenCalledWith('hot');
        expect(next).toHaveFocus();
        expect(announce).toHaveBeenCalledWith('Finding dismissed for this session.', { polite: true });
        rerender(
            <OverviewFindingDetails
                overview={{ ...overview, dismissedAdvisoryIds: new Set(['hot']) }}
                section="findings"
            />,
        );
        expect(screen.queryByRole('heading', { name: 'Hot partition' })).not.toBeInTheDocument();
        expect(next).toHaveFocus();
        fireEvent.click(next);
        expect(overview.handleDismissAdvisory).toHaveBeenLastCalledWith('next');
        const tableContainer = screen.getByRole('group', { name: 'Account health' });
        expect(tableContainer).toHaveFocus();
        rerender(
            <OverviewFindingDetails
                overview={{ ...overview, dismissedAdvisoryIds: new Set(['hot', 'next']) }}
                section="findings"
            />,
        );
        expect(tableContainer).toHaveFocus();
        expect(screen.queryByRole('row')).not.toBeInTheDocument();
        expect(screen.getByText('2 derived findings dismissed for this session.')).toBeInTheDocument();
    });

    it('limits each summary to three ranked rows and routes category navigation independently', () => {
        const overview = populatedFindings();
        const onInspect = vi.fn();
        const { container } = render(
            <>
                <OverviewFindings overview={overview} onInspect={onInspect} />
                <OverviewRecommendations overview={overview} onInspect={onInspect} />
            </>,
        );
        for (const [name, allLabel, section] of [
            ['Account health', 'View all alerts', 'findings'],
            ['Prioritized recommendations', 'View all recommendations', 'recommendations'],
        ]) {
            const region = within(screen.getByRole('region', { name }));
            const table = region.getByRole('table');
            expect(within(table).getAllByRole('row')).toHaveLength(3);
            const actions = within(table).getAllByRole('button');
            expect(actions).toHaveLength(3);
            for (const action of actions) {
                expect(action).toHaveTextContent('View details');
                expect(action).toHaveAccessibleName('View details');
                fireEvent.click(action);
                expect(onInspect).toHaveBeenLastCalledWith(section);
            }
            const viewAll = region.getByRole('button', { name: allLabel });
            expect(viewAll).toHaveTextContent(allLabel);
            fireEvent.click(viewAll);
            expect(onInspect).toHaveBeenLastCalledWith(section);
        }
        expect(screen.getByText('Showing 3 of 11 health groups.')).toBeInTheDocument();
        expect(screen.getByText('Showing 3 of 11 recommendations.')).toBeInTheDocument();
        expect(screen.queryByText('Health issue 3')).not.toBeInTheDocument();
        expect(screen.queryByText('Azure Advisor recommendation 0')).not.toBeInTheDocument();
        expect(screen.queryByText('Review provisioned capacity')).not.toBeInTheDocument();
        expect(
            screen.getByText('Derived optimization opportunities and Azure Advisor guidance, ranked by importance.'),
        ).toBeInTheDocument();
        const recommendationRows = within(
            screen.getByRole('table', { name: 'Prioritized recommendations' }),
        ).getAllByRole('row');
        expect(recommendationRows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
            'Health issue 11',
            'Health issue 12',
            'Health issue 13',
        ]);
        expect(screen.queryByText(/Diagnostic coverage|confidence/i)).not.toBeInTheDocument();
        expect(container.querySelector('details')).not.toBeInTheDocument();
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
        expect(onInspect).toHaveBeenCalledWith('recommendations');
    });

    it('places idle, over-provisioned and serverless opportunities in recommendations even without Advisor rows', () => {
        const overview = overviewState();
        overview.alerts!.available = true;
        const advisory = overview.derivedAdvisories!.advisories[0];
        overview.derivedAdvisories!.logSource = { available: false, reason: 'rbac' };
        overview.derivedAdvisories!.advisories = [
            {
                ...advisory,
                id: 'idle',
                rule: 'IdleContainer',
                severity: 'High',
                title: 'Idle container evidence',
                scope: 'database/container',
            },
            {
                ...advisory,
                id: 'over',
                rule: 'OverProvisioning',
                severity: 'High',
                title: 'Over-provisioning evidence',
                scope: undefined,
            },
            {
                ...advisory,
                id: 'serverless',
                rule: 'ServerlessCandidate',
                severity: 'Low',
                title: 'Serverless candidate evidence',
                scope: undefined,
            },
        ];
        const onInspect = vi.fn();
        const { rerender } = render(
            <>
                <OverviewFindings overview={overview} onInspect={onInspect} />
                <OverviewRecommendations overview={overview} onInspect={onInspect} />
            </>,
        );
        const health = within(screen.getByRole('region', { name: 'Account health' }));
        expect(health.queryByRole('row')).not.toBeInTheDocument();
        const recommendations = within(screen.getByRole('region', { name: 'Prioritized recommendations' }));
        expect(recommendations.getAllByRole('row')).toHaveLength(3);
        for (const item of overview.derivedAdvisories!.advisories) {
            const heading = recommendations.getByRole('heading', { name: item.title });
            const row = within(heading.closest('tr')!);
            expect(row.getByText(`Scope: ${item.scope ?? 'Account-wide'}`)).toBeInTheDocument();
            expect(row.getByRole('cell', { name: `Severity: ${item.severity}` })).toBeInTheDocument();
            expect(
                row.getByText(`Estimated impact: ${derivedFindingPresentation[item.rule].estimatedImpact}`),
            ).toBeInTheDocument();
        }
        expect(health.getByRole('button', { name: 'Log-based checks: missing access' })).toHaveAccessibleDescription(
            'Not enough permissions: your role is missing Log Analytics Reader.',
        );
        expect(recommendations.queryByRole('button', { name: /Log-based|Derived/ })).not.toBeInTheDocument();
        fireEvent.click(recommendations.getByRole('button', { name: 'View all recommendations' }));
        expect(onInspect).toHaveBeenCalledWith('recommendations');

        rerender(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.queryByRole('row')).not.toBeInTheDocument();
        expect(
            screen.getByText(
                'Partial coverage — log-based checks did not run: Log Analytics Reader access is missing.',
            ),
        ).toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
        expect(screen.getAllByRole('row')).toHaveLength(3);
        expect(screen.getByText('Derived checks: Available')).toBeInTheDocument();
        expect(screen.getByText('Azure Advisor: Available')).toBeInTheDocument();
        expect(screen.queryByText(/Partial coverage|Log Analytics/)).not.toBeInTheDocument();
        for (const item of overview.derivedAdvisories!.advisories) {
            const heading = screen.getByRole('heading', { name: item.title });
            const row = within(heading.closest('tr')!);
            expect(row.getByText(`Scope: ${item.scope ?? 'Account-wide'}`)).toBeInTheDocument();
            expect(row.getByText(item.rationale)).toBeInTheDocument();
            expect(row.getByText(item.suggestedAction)).toBeInTheDocument();
            const dismiss = row.getByRole('button', { name: 'Dismiss' });
            expect(dismiss).toHaveAccessibleDescription(`Dismiss ${item.title} for this session only.`);
            fireEvent.click(dismiss);
            expect(overview.handleDismissAdvisory).toHaveBeenLastCalledWith(item.id);
        }
        overview.dismissedAdvisoryIds = new Set(['idle', 'over', 'serverless']);
        rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
        expect(screen.queryByRole('row')).not.toBeInTheDocument();
        expect(screen.getByText('3 derived findings dismissed for this session.')).toBeInTheDocument();
        expect(
            screen.getByText(
                'No recommendations from available derived checks or Azure Advisor. Dismissed findings are not shown.',
            ),
        ).toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.queryByText(/derived findings dismissed/)).not.toBeInTheDocument();
    });

    it.each(['unavailable', 'loading', 'not loaded', 'logs disabled', 'missing log access', 'dismissed'] as const)(
        'reflects derived availability in recommendations but excludes health-only log coverage when %s',
        (state) => {
            const overview = overviewState();
            switch (state) {
                case 'unavailable':
                    overview.derivedAdvisories!.available = false;
                    overview.derivedAdvisories!.reason = 'rbac';
                    break;
                case 'loading':
                    overview.derivedLoading = true;
                    break;
                case 'not loaded':
                    overview.derivedAdvisories = undefined;
                    break;
                case 'logs disabled':
                    overview.derivedAdvisories!.logSource = { available: false, reason: 'logAnalyticsDisabled' };
                    break;
                case 'missing log access':
                    overview.derivedAdvisories!.logSource = { available: false, reason: 'rbac' };
                    break;
                case 'dismissed':
                    overview.dismissedAdvisoryIds = new Set(['hot', 'cost', 'advisor-0']);
                    break;
            }
            const { rerender } = render(<OverviewRecommendations overview={overview} onInspect={vi.fn()} />);
            const assertCoverage = () => {
                expect(screen.getByRole('group', { name: 'Prioritized recommendations' })).toHaveAttribute(
                    'aria-busy',
                    state === 'loading' ? 'true' : 'false',
                );
                expect(
                    screen.queryByText(/Log-based|Log Analytics|Partial coverage|derived findings dismissed/),
                ).not.toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
            };
            const empty =
                state === 'loading'
                    ? 'Loading recommendations…'
                    : state === 'unavailable' || state === 'not loaded'
                      ? 'No recommendations to show; some sources are unavailable or have not loaded.'
                      : 'No recommendations from available derived checks or Azure Advisor. Dismissed findings are not shown.';
            assertCoverage();
            expect(screen.getByText(empty)).toBeInTheDocument();
            expect(screen.queryByRole('row')).not.toBeInTheDocument();
            rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
            assertCoverage();
            expect(screen.getByText(empty)).toBeInTheDocument();
            expect(screen.getByText('Azure Advisor: Available')).toBeInTheDocument();
            expect(screen.getByText(/^Derived checks:/)).toBeInTheDocument();
            overview.recommendations!.recommendations = advisorRecommendations();
            rerender(<OverviewRecommendations overview={overview} onInspect={vi.fn()} />);
            assertCoverage();
            expect(screen.getAllByRole('row')).toHaveLength(3);
            expect(screen.getByText('Showing 3 of 4 recommendations.')).toBeInTheDocument();
            rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
            assertCoverage();
            expect(screen.getAllByRole('row')).toHaveLength(4);
            expect(screen.getAllByText('Source: Azure Advisor')).toHaveLength(4);
        },
    );

    it('selects three severity-ranked health groups before limiting rows, but expands every container in details', () => {
        const overview = overviewState();
        const hot = overview.derivedAdvisories!.advisories[0];
        overview.derivedAdvisories!.advisories = [
            ...['a', 'b', 'c', 'd'].map((container) => ({
                ...hot,
                id: container,
                title: `Hot partition in ${container}`,
                scope: `database/${container}`,
            })),
            { ...hot, id: 'growth', rule: 'StorageGrowthRisk', severity: 'Medium', title: 'Growth evidence' },
            { ...hot, id: 'skew', rule: 'StorageSkewRisk', severity: 'Low', title: 'Skew evidence' },
        ];
        overview.alerts = {
            ...overview.alerts!,
            available: true,
            alerts: [
                {
                    id: 'critical',
                    severity: 'Critical',
                    rawSeverity: 'Sev0',
                    name: 'Critical Azure alert',
                    portalUrl: 'https://portal.azure.com/#alert',
                },
            ],
        };
        const { rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        const rows = screen.getAllByRole('row');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByRole('heading')).toHaveTextContent('Critical Azure alert');
        expect(within(rows[1]).getByRole('heading')).toHaveTextContent('Hot partitions');
        expect(within(rows[1]).getByText('database/a + others')).toBeInTheDocument();
        expect(within(rows[2]).getByRole('heading')).toHaveTextContent('Storage growth risk');
        expect(screen.queryByText('Storage skew')).not.toBeInTheDocument();
        expect(screen.getByText('Showing 3 of 4 health groups.')).toBeInTheDocument();
        expect(screen.getByText('Critical attention required')).toBeInTheDocument();
        expect(
            screen.getByText('7 active issues · 1 critical · 5 warnings · 1 informational'),
        ).toHaveAccessibleDescription(
            'Counts include individual issues from available sources, before grouping. Dismissed issues are excluded.',
        );
        expect(within(rows[0]).getByText('Not estimated')).toBeInTheDocument();
        expect(within(rows[1]).getByText('May reduce hot-partition throttling')).toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.getAllByRole('row')).toHaveLength(7);
        for (const container of ['a', 'b', 'c', 'd']) {
            expect(screen.getByRole('heading', { name: `Hot partition in ${container}` })).toBeInTheDocument();
            expect(screen.getByText(`Scope: database/${container}`)).toBeInTheDocument();
        }
        expect(screen.queryByText(/\+ others/)).not.toBeInTheDocument();
    });

    it('counts individual health issues before grouping, excluding dismissals, recommendations and stale alerts', () => {
        const overview = overviewState();
        const hot = overview.derivedAdvisories!.advisories[0];
        overview.derivedAdvisories!.advisories = [
            ...['a', 'b', 'c', 'd'].map((id) => ({ ...hot, id, scope: `database/${id}` })),
            { ...hot, id: 'growth', rule: 'StorageGrowthRisk', severity: 'Medium' },
            { ...hot, id: 'low', rule: 'StorageSkewRisk', severity: 'Low' },
            { ...hot, id: 'idle', rule: 'IdleContainer' },
        ];
        overview.dismissedAdvisoryIds = new Set(['a', 'unknown-id']);
        overview.recommendations!.recommendations = advisorRecommendations();
        overview.alerts = {
            ...overview.alerts!,
            available: true,
            timeRange: '7d',
            criticalCount: 99,
            warningCount: 99,
            alerts: [
                {
                    id: 'stale',
                    name: 'Stale critical alert',
                    severity: 'Critical',
                    rawSeverity: 'Sev0',
                    portalUrl: 'https://portal.azure.com',
                },
            ],
        };
        const { rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getAllByRole('row')).toHaveLength(3);
        expect(screen.getByText('Attention required')).toBeInTheDocument();
        expect(screen.queryByText('Critical attention required')).not.toBeInTheDocument();
        expect(screen.getByText('5 active issues · 4 warnings · 1 informational')).toBeInTheDocument();
        expect(screen.getByText('database/b + others')).toBeInTheDocument();
        expect(screen.queryByText('database/a')).not.toBeInTheDocument();
        expect(screen.queryByText('Stale critical alert')).not.toBeInTheDocument();

        overview.dismissedAdvisoryIds = new Set(['a', 'b', 'c', 'd', 'growth']);
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText('Informational issues detected')).toBeInTheDocument();
        expect(screen.getByText('1 active issue · 1 informational')).toBeInTheDocument();
        overview.dismissedAdvisoryIds = new Set([...overview.dismissedAdvisoryIds, 'low']);
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText('Health data incomplete')).toBeInTheDocument();
        expect(screen.getByText('0 active issues')).toBeInTheDocument();
        overview.derivedLoading = true;
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText('Checking account health…')).toBeInTheDocument();
        overview.derivedLoading = false;
        overview.alerts.alerts = [];
        overview.alerts.timeRange = overview.alertTimeRange;
        overview.derivedAdvisories!.logSource = { available: true };
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText('No active issues detected')).toBeInTheDocument();
        expect(screen.getByText('0 active issues')).toBeInTheDocument();
    });

    it('reports only category-relevant, known, unique dismissed derived IDs in each full dialog', () => {
        const overview = populatedFindings();
        const duplicate = overview.derivedAdvisories!.advisories[11];
        overview.derivedAdvisories!.advisories.push({ ...duplicate });
        overview.dismissedAdvisoryIds = new Set(['health-0', 'health-11', 'health-12', 'unknown', 'cost']);
        const { rerender } = render(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.getByText('1 derived findings dismissed for this session.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Health issue 0' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(10);
        rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
        expect(screen.getByText('2 derived findings dismissed for this session.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Health issue 11' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Health issue 12' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Review provisioned capacity' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(5);
        const dismiss = screen.getAllByRole('button', { name: 'Dismiss' })[0];
        fireEvent.click(dismiss);
        expect(overview.handleDismissAdvisory).toHaveBeenCalledWith('health-13');
    });

    it.each([
        ['derived', 'unavailable'],
        ['derived', 'not loaded'],
        ['derived', 'loading'],
        ['advisor', 'unavailable'],
        ['advisor', 'not loaded'],
        ['advisor', 'loading'],
    ] as const)(
        'keeps recommendations visible with honest %s %s coverage and the other source intact',
        (source, state) => {
            const overview = overviewState();
            overview.derivedAdvisories!.advisories = [
                {
                    ...overview.derivedAdvisories!.advisories[0],
                    id: 'optimization',
                    rule: 'OverProvisioning',
                    title: 'Derived optimization',
                },
            ];
            overview.recommendations!.recommendations = advisorRecommendations().slice(0, 1);
            if (source === 'derived') {
                if (state === 'loading') {
                    overview.derivedLoading = true;
                } else if (state === 'not loaded') {
                    overview.derivedAdvisories = undefined;
                } else {
                    overview.derivedAdvisories!.available = false;
                    overview.derivedAdvisories!.reason = 'rbac';
                }
            } else if (state === 'loading') {
                overview.recommendationsLoading = true;
            } else if (state === 'not loaded') {
                overview.recommendations = undefined;
            } else {
                overview.recommendations!.available = false;
                overview.recommendations!.reason = 'rbac';
            }
            const { rerender } = render(<OverviewRecommendations overview={overview} onInspect={vi.fn()} />);
            expect(screen.getByRole('group', { name: 'Prioritized recommendations' })).toHaveAttribute(
                'aria-busy',
                state === 'loading' ? 'true' : 'false',
            );
            const sourceLabel = source === 'derived' ? 'Derived checks' : 'Azure Advisor';
            const status = state === 'loading' ? 'updating' : state === 'unavailable' ? 'missing access' : 'not loaded';
            expect(screen.getByRole('button', { name: `${sourceLabel}: ${status}` })).toBeVisible();
            expect(
                screen.getByRole('heading', {
                    name: source === 'derived' ? 'Review provisioned capacity' : 'Derived optimization',
                }),
            ).toBeInTheDocument();
            expect(screen.getAllByRole('row')).toHaveLength(state === 'loading' ? 2 : 1);
            expect(screen.queryByRole('button', { name: /Log-based/ })).not.toBeInTheDocument();
            expect(screen.queryAllByText('Updating; displayed findings are from the previous snapshot.')).toHaveLength(
                state === 'loading' ? 1 : 0,
            );
            rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
            expect(screen.getAllByRole('row')).toHaveLength(state === 'loading' ? 2 : 1);
            expect(screen.getByText(/^Derived checks:/)).toBeInTheDocument();
            expect(screen.getByText(/^Azure Advisor:/)).toBeInTheDocument();
            expect(screen.queryByText(/Azure Monitor alerts|Partial coverage/)).not.toBeInTheDocument();
        },
    );

    it('ignores Advisor loading and availability in health while derived loading affects both categories', () => {
        const overview = overviewState();
        overview.alerts!.available = true;
        overview.derivedAdvisories!.logSource = { available: true };
        overview.derivedAdvisories!.advisories = [];
        overview.recommendations!.available = false;
        overview.recommendationsLoading = true;
        const { rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByText('No active issues detected')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Account health' })).toHaveAttribute('aria-busy', 'false');
        expect(screen.queryByRole('button', { name: /Advisor/ })).not.toBeInTheDocument();
        overview.derivedLoading = true;
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByRole('group', { name: 'Account health' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Checking account health…')).toBeInTheDocument();
        overview.recommendationsLoading = false;
        rerender(<OverviewRecommendations overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByRole('group', { name: 'Prioritized recommendations' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Loading recommendations…')).toBeInTheDocument();
    });

    it('places partial-source pills inside the table header without hiding findings', () => {
        render(<OverviewFindings overview={overviewState()} onInspect={vi.fn()} />);
        const header = screen.getByText('Attention required').parentElement!;
        expect(screen.getByRole('group', { name: 'Account health' })).toContainElement(header);
        expect(header).toContainElement(screen.getByRole('button', { name: 'Azure alerts: missing access' }));
        expect(header).toContainElement(screen.getByRole('button', { name: 'Log-based checks: logs disabled' }));
        expect(screen.getByRole('heading', { name: 'Hot partitions' })).toBeInTheDocument();
        expect(screen.queryByText('Diagnostic coverage')).not.toBeInTheDocument();
    });

    it('shows complete category-filtered detail tables and source-specific evidence without inventory coverage', () => {
        const overview = populatedFindings();
        const { rerender } = render(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.getAllByRole('row')).toHaveLength(11);
        expect(screen.getByRole('heading', { name: 'Health issue 3' })).toBeInTheDocument();
        for (const advisory of overview.derivedAdvisories!.advisories) {
            expect(screen.queryAllByRole('heading', { name: advisory.title })).toHaveLength(
                derivedFindingPresentation[advisory.rule].section === 'findings' ? 1 : 0,
            );
        }
        expect(screen.queryByText('Review provisioned capacity')).not.toBeInTheDocument();
        const first = within(screen.getAllByRole('row')[0]);
        for (const text of [
            'Source: Derived finding',
            'Scope: database/container',
            'Threshold 90%',
            'Saturation with headroom elsewhere.',
            'Review the partition key.',
        ]) {
            expect(first.getByText(text)).toBeInTheDocument();
        }
        expect(screen.getByText(/Azure Monitor alerts.*permission/)).toBeInTheDocument();
        expect(screen.getByText(/Partial coverage.*Diagnostic settings/)).toBeInTheDocument();
        expect(screen.getByText(/source-specific lookbacks, not the chart scope or time window/)).toBeInTheDocument();
        expect(screen.queryByText(/Inventory telemetry/)).not.toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
        expect(screen.getAllByRole('row')).toHaveLength(11);
        expect(screen.queryByText('Health issue 0')).not.toBeInTheDocument();
        expect(screen.getAllByText('Source: Derived finding')).toHaveLength(7);
        expect(screen.getByRole('heading', { name: 'Azure Advisor recommendation 0' })).toBeInTheDocument();
        expect(screen.getAllByText('Source: Azure Advisor')).toHaveLength(4);
        expect(screen.getByText('Advisor-reported potential benefit: USD 20')).toBeInTheDocument();
        expect(screen.getAllByText('Scope: Account-associated; detailed resource scope is not provided')).toHaveLength(
            4,
        );
        expect(screen.getByText('Azure Advisor: Available')).toBeInTheDocument();
        expect(
            screen.queryByText(/Azure Monitor alerts|Inventory telemetry|Partial coverage|Derived findings/),
        ).not.toBeInTheDocument();
        expect(screen.getByText('Derived checks: Available')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(7);
    });

    it('preserves external alert and Advisor actions only in their full details', () => {
        const overview = populatedFindings();
        overview.alerts!.available = true;
        overview.alerts!.alerts = [
            {
                id: 'alert',
                name: 'Azure alert',
                severity: 'Critical',
                rawSeverity: 'Sev0',
                targetResource: 'account-resource',
                portalUrl: 'https://portal.azure.com/#alert',
            },
        ];
        const { rerender } = render(<OverviewFindingDetails overview={overview} section="findings" />);
        const alertAction = screen.getByRole('button', { name: 'Inspect Azure alert' });
        expect(alertAction).toHaveTextContent('Inspect Azure alert');
        expect(alertAction).toHaveAccessibleDescription('Azure alert');
        fireEvent.click(alertAction);
        expect(overview.handleOpenUrl).toHaveBeenLastCalledWith('https://portal.azure.com/#alert');
        expect(within(alertAction.closest('tr')!).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="recommendations" />);
        const advisorAction = screen.getByRole('button', { name: 'Learn more' });
        expect(advisorAction).toHaveTextContent('Learn more');
        expect(advisorAction).toHaveAccessibleDescription('Review provisioned capacity');
        fireEvent.click(advisorAction);
        expect(overview.handleOpenUrl).toHaveBeenLastCalledWith('https://learn.microsoft.com/azure/cosmos-db/');
        expect(within(advisorAction.closest('tr')!).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
        rerender(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Inspect Azure alert' })).not.toBeInTheDocument();
        rerender(<OverviewRecommendations overview={overview} onInspect={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Learn more' })).not.toBeInTheDocument();
    });

    it.each(['findings', 'recommendations'] as const)(
        'keeps %s loading and empty states honest with category-specific availability',
        (section) => {
            const overview = overviewState();
            overview.derivedAdvisories!.advisories = [];
            if (section === 'recommendations') {
                overview.recommendations!.available = false;
            }
            const Summary = section === 'findings' ? OverviewFindings : OverviewRecommendations;
            const { rerender } = render(<Summary overview={overview} onInspect={vi.fn()} />);
            expect(screen.getByText(/some sources are unavailable or have not loaded/)).toBeInTheDocument();
            expect(screen.queryByText(/healthy|Diagnostic coverage/i)).not.toBeInTheDocument();
            overview.alerts!.available = true;
            overview.derivedAdvisories!.logSource = { available: true };
            overview.recommendations!.available = true;
            rerender(<Summary overview={{ ...overview }} onInspect={vi.fn()} />);
            const empty =
                section === 'findings'
                    ? 'No active health findings reported by available checks. Dismissed findings are not shown.'
                    : 'No recommendations from available derived checks or Azure Advisor. Dismissed findings are not shown.';
            expect(screen.getByText(empty)).toBeInTheDocument();
            expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'false');
            if (section === 'findings') {
                overview.derivedLoading = true;
            } else {
                overview.recommendationsLoading = true;
            }
            rerender(<Summary overview={{ ...overview }} onInspect={vi.fn()} />);
            expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
            expect(screen.getByText(/Loading (health findings|recommendations)/)).toBeInTheDocument();
            expect(screen.queryByText(empty)).not.toBeInTheDocument();
            rerender(<OverviewFindingDetails overview={overview} section={section} />);
            expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
            expect(
                screen.getByText(section === 'findings' ? /Derived checks: Updating/ : /Azure Advisor: Updating/),
            ).toBeInTheDocument();
        },
    );

    it('marks previous findings busy during updates and suppresses alerts from a different window', () => {
        const overview = overviewState();
        overview.alerts = {
            ...overview.alerts!,
            available: true,
            timeRange: '7d',
            alerts: [
                {
                    id: 'stale',
                    name: 'Stale alert',
                    severity: 'Critical',
                    rawSeverity: 'Sev0',
                    portalUrl: 'https://portal.azure.com/#stale',
                },
            ],
        };
        overview.derivedLoading = true;
        const { rerender } = render(<OverviewFindings overview={overview} onInspect={vi.fn()} />);
        expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Updating; displayed findings are from the previous snapshot.')).toBeInTheDocument();
        expect(screen.queryByText('Stale alert')).not.toBeInTheDocument();
        expect(screen.getByText('Hot partitions')).toBeInTheDocument();
        rerender(<OverviewFindingDetails overview={overview} section="findings" />);
        expect(screen.getByText(/Azure Monitor alerts.*Waiting for the selected alert window/)).toBeInTheDocument();
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
            ['Review capacity details', 'capacity'],
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
