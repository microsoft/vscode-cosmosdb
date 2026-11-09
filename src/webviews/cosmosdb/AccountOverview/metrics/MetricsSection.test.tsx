/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountMetricApplicability } from '../../../../panels/accountOverview/metrics/contracts';
import { type MetricKey, type MetricPoint, type MetricSeriesResult, type StorageMeasurement } from '../../../api/types';
import { METRIC_GROUPS, METRIC_ORDER, METRIC_VIEWS } from './descriptors';
import { MetricsSection } from './MetricsSection';

vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: PropsWithChildren) => children,
    LineChart: ({ data, children }: PropsWithChildren<{ data: MetricPoint[] }>) => (
        <div data-testid="metric-plot">
            {JSON.stringify(data)}
            {children}
        </div>
    ),
    CartesianGrid: () => null,
    Line: ({
        dataKey,
        name,
        connectNulls,
        strokeDasharray,
    }: {
        dataKey: string;
        name?: string;
        connectNulls?: boolean;
        strokeDasharray?: string;
    }) => (
        <div data-testid={`line-${dataKey}`} data-connect-nulls={String(connectNulls)} data-dash={strokeDasharray}>
            {name}
        </div>
    ),
    Legend: () => null,
    ReferenceArea: () => null,
    ReferenceLine: () => null,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
}));

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

type Props = ComponentProps<typeof MetricsSection>;
const provisioned = getAccountMetricApplicability(false);
const serverless = getAccountMetricApplicability(true);

function renderMetrics(overrides: Partial<Props> = {}) {
    const props: Props = {
        order: METRIC_ORDER,
        seriesByMetric: {},
        loading: false,
        timeRange: '24H',
        ...overrides,
    };
    const rendered = render(<MetricsSection {...props} />, { wrapper: Wrapper });
    return {
        ...rendered,
        update: (next: Partial<Props>) => rendered.rerender(<MetricsSection {...props} {...next} />),
    };
}

function metricTile(metric: MetricKey) {
    return screen.getByRole('button', { name: new RegExp(`^${METRIC_VIEWS[metric].label.replace('+', '\\+')}`) });
}

function tileLabels() {
    return screen
        .getAllByRole('button')
        .filter((button) => !button.getAttribute('aria-label')?.startsWith('Show chart:'))
        .map((button) => button.firstElementChild?.textContent);
}

function emptySeries(metric: MetricKey, reason: MetricSeriesResult['reason'] = 'noData'): MetricSeriesResult {
    return {
        metric,
        applicability: { status: 'applicable' },
        available: false,
        reason,
        points: [],
        timeRange: '24H',
        generatedAt: 0,
    };
}

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        return this.parentElement;
    });
});
afterEach(() => vi.restoreAllMocks());

it('uses a focusable themed tooltip instead of a native title for metric-group explanations', async () => {
    const user = userEvent.setup();
    renderMetrics({ chartAffordances: true });
    const legend = screen.getByText(METRIC_GROUPS.state.label).parentElement!;
    expect(legend).not.toHaveAttribute('title');
    expect(legend).toHaveAttribute('tabindex', '0');
    expect(legend).toHaveAccessibleDescription(METRIC_GROUPS.state.description);
    await user.click(legend);
    expect(legend).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(METRIC_GROUPS.state.description);
});

describe.each([false, true])('storage breakdown with chartAffordances=%s', (chartAffordances) => {
    const complete: StorageMeasurement = {
        data: { status: 'available', bytes: 100, timestamp: 1000 },
        index: { status: 'available', bytes: 10, timestamp: 1000 },
    };
    const partial: StorageMeasurement = {
        data: { status: 'available', bytes: 200, timestamp: 2000 },
        index: { status: 'unavailable', reason: 'error' },
    };

    it('shows the newest partial value, accessible details, and two gap-preserving chart lines', async () => {
        const user = userEvent.setup();
        renderMetrics({
            chartAffordances,
            requestedMetric: 'dataIndexUsage',
            seriesByMetric: {
                dataIndexUsage: {
                    ...emptySeries('dataIndexUsage'),
                    available: true,
                    reason: undefined,
                    storage: partial,
                    points: [
                        { timestamp: 1000, value: 110, storage: complete },
                        { timestamp: 2000, storage: partial },
                    ],
                    peak: 110,
                },
            },
        });
        const tile = metricTile('dataIndexUsage');
        expect(within(tile).getByText('200 B')).toBeVisible();
        expect(within(tile).getByText('Partial data')).toBeVisible();
        expect(tile).toHaveAccessibleName(/Data \+ index usage 200 B Partial data/);
        expect(tile).toHaveAccessibleDescription('State Data: 200 B; indexes: Unable to load.');
        fireEvent.keyDown(document, { key: 'Tab' });
        act(() => tile.focus());
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Data: 200 B; indexes: Unable to load.');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
        expect(tile).toHaveFocus();
        const chart = screen.getByRole('region', { name: 'Data + index usage trend' });
        expect(within(chart).getByRole('figure')).toHaveAccessibleDescription(
            'Data: 200 B; indexes: Unable to load. Data uses a solid line; indexes use a dashed line. Missing observations appear as gaps.',
        );
        expect(within(chart).queryByText(/Data: 200 B; indexes: Unable to load/)).not.toBeInTheDocument();
        expect(within(chart).queryByText(/Missing observations appear as gaps/)).not.toBeInTheDocument();
        expect(within(chart).queryByText('Partial data')).not.toBeInTheDocument();
        expect(screen.getByTestId('line-dataBytes')).toHaveAttribute('data-connect-nulls', 'false');
        expect(screen.getByTestId('line-indexBytes')).toHaveAttribute('data-connect-nulls', 'false');
        expect(screen.getByTestId('line-indexBytes')).toHaveAttribute('data-dash', '6 4');
        expect(screen.queryByTestId('line-value')).not.toBeInTheDocument();
        expect(screen.getByTestId('metric-plot')).toHaveTextContent('"dataBytes":200');
    });

    it('explains both failures when storage is unavailable instead of displaying zero', () => {
        renderMetrics({
            chartAffordances,
            requestedMetric: 'dataIndexUsage',
            seriesByMetric: {
                dataIndexUsage: {
                    ...emptySeries('dataIndexUsage', 'rbac'),
                    storage: {
                        data: { status: 'unavailable', reason: 'rbac' },
                        index: { status: 'unavailable', reason: 'error' },
                    },
                },
            },
        });
        expect(within(metricTile('dataIndexUsage')).getByText('—')).toBeVisible();
        expect(metricTile('dataIndexUsage')).toHaveAccessibleDescription(
            'State Data: No permission; indexes: Unable to load.',
        );
        const chart = screen.getByRole('region', { name: 'Data + index usage trend' });
        expect(within(chart).getByText('Storage unavailable')).toBeVisible();
        expect(within(chart).getByText('Data: No permission; indexes: Unable to load.')).toBeVisible();
        expect(screen.queryByTestId('metric-plot')).not.toBeInTheDocument();
    });
});

describe.each([false, true])('metric applicability with chartAffordances=%s', (chartAffordances) => {
    it('hides inapplicable tiles and defaults to consumed RU even while loading', () => {
        renderMetrics({ chartAffordances, applicabilityByMetric: serverless, loading: true });
        expect(tileLabels()).toEqual([
            'Data + index usage',
            'Document count',
            'Total requests',
            'Total request units',
            'Metadata requests',
            'Server-side latency',
            'Service availability',
        ]);
        expect(metricTile('totalRequestUnits')).toHaveAttribute('aria-pressed', 'true');
        for (const metric of ['normalizedRu', 'provisionedThroughput'] as const) {
            expect(
                screen.queryByRole('button', { name: new RegExp(METRIC_VIEWS[metric].label) }),
            ).not.toBeInTheDocument();
        }
        expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
    });

    it('does not reorder applicable tiles for loading, empty, permission, or other failures', () => {
        const { update } = renderMetrics({ chartAffordances, applicabilityByMetric: provisioned, loading: true });
        const order = tileLabels();
        expect(order.slice(0, 4)).toEqual([
            'Normalized RU',
            'Data + index usage',
            'Provisioned throughput',
            'Document count',
        ]);
        const seriesByMetric = {
            normalizedRu: emptySeries('normalizedRu'),
            dataIndexUsage: emptySeries('dataIndexUsage', 'rbac'),
            provisionedThroughput: emptySeries('provisionedThroughput', 'unsupported'),
            documentCount: emptySeries('documentCount', 'error'),
        };
        update({ applicabilityByMetric: provisioned, seriesByMetric, loading: false });
        expect(tileLabels()).toEqual(order);
        expect(metricTile('normalizedRu')).toHaveTextContent('No data');
        expect(metricTile('dataIndexUsage')).toHaveTextContent('No permission');
        expect(metricTile('provisionedThroughput')).toHaveTextContent('Not supported');
        expect(metricTile('documentCount')).toHaveTextContent('Unable to load');
        expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
    });

    it('updates the default when applicability arrives, but preserves an explicit selection and focus across refreshes', async () => {
        const user = userEvent.setup();
        const { update } = renderMetrics({ chartAffordances, loading: true });
        expect(metricTile('normalizedRu')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
        update({ applicabilityByMetric: serverless, loading: false });
        expect(metricTile('totalRequestUnits')).toHaveAttribute('aria-pressed', 'true');
        await user.click(metricTile('totalRequests'));
        const focused = metricTile('totalRequests');
        update({ applicabilityByMetric: { ...serverless }, loading: true, timeRange: '7D' });
        expect(focused).toHaveFocus();
        expect(focused).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('region', { name: 'Total requests trend' })).toBeVisible();
        update({ applicabilityByMetric: provisioned, loading: false });
        expect(metricTile('totalRequests')).toBe(focused);
        expect(focused).toHaveFocus();
        expect(focused).toHaveAttribute('aria-pressed', 'true');
    });

    it('moves focus to consumed RU when metadata removes the focused metric', async () => {
        const user = userEvent.setup();
        const { update } = renderMetrics({ chartAffordances, loading: true });
        await user.click(metricTile('normalizedRu'));
        const focused = metricTile('normalizedRu');
        update({ applicabilityByMetric: serverless, loading: true });
        expect(focused).not.toBeInTheDocument();
        expect(metricTile('totalRequestUnits')).toHaveFocus();
        expect(metricTile('totalRequestUnits')).toHaveAttribute('aria-pressed', 'true');
    });

    it('redirects explicit navigation to an inapplicable metric to consumed RU', () => {
        renderMetrics({
            chartAffordances,
            applicabilityByMetric: serverless,
            requestedMetric: 'provisionedThroughput',
        });
        expect(metricTile('totalRequestUnits')).toHaveAttribute('aria-pressed', 'true');
        const chart = screen.getByRole('region', { name: 'Total request units trend' });
        expect(chart).toHaveFocus();
        expect(screen.queryByRole('region', { name: 'Provisioned throughput trend' })).not.toBeInTheDocument();
    });

    it.each([
        { requestedMetric: 'dataIndexUsage', destination: 'Data + index usage trend', applicability: provisioned },
        {
            requestedMetric: 'provisionedThroughput',
            destination: 'Total request units trend',
            applicability: serverless,
        },
    ] as const)(
        'focuses only the committed destination for $requestedMetric navigation',
        async ({ requestedMetric, destination, applicability }) => {
            const user = userEvent.setup();
            const { update } = renderMetrics({
                chartAffordances,
                applicabilityByMetric: applicability,
                requestedMetric: 'totalRequests',
                navigationRevision: 1,
            });
            await user.click(metricTile('documentCount'));
            const chart = screen.getByRole('region', { name: 'Document count trend' });
            const focusedNames: (string | null)[] = [];
            chart.addEventListener('focus', () => focusedNames.push(chart.getAttribute('aria-label')));

            update({ requestedMetric, navigationRevision: 2 });

            expect(focusedNames).toEqual([destination]);
            expect(chart).toHaveAccessibleName(destination);
            expect(chart).toHaveFocus();
            expect(chart).toHaveTextContent(destination);

            await user.click(metricTile('documentCount'));
            update({ requestedMetric, navigationRevision: 2 });
            expect(metricTile('documentCount')).toHaveFocus();
            expect(focusedNames).toEqual([destination]);
        },
    );

    it('defers navigation focus until Monitoring is active', () => {
        const { update } = renderMetrics({
            chartAffordances,
            active: false,
            requestedMetric: 'normalizedRu',
            navigationRevision: 1,
        });
        const chart = screen.getByRole('region', { name: 'Normalized RU trend' });
        const focusedNames: (string | null)[] = [];
        chart.addEventListener('focus', () => focusedNames.push(chart.getAttribute('aria-label')));
        update({ active: false, requestedMetric: 'totalRequests', navigationRevision: 2 });
        expect(focusedNames).toEqual([]);
        update({ active: true, requestedMetric: 'totalRequests', navigationRevision: 2 });
        expect(focusedNames).toEqual(['Total requests trend']);
        expect(chart).toHaveFocus();
    });

    it('does not show stale samples or a zero line after known inapplicability arrives', () => {
        const { update } = renderMetrics({
            chartAffordances,
            requestedMetric: 'normalizedRu',
            seriesByMetric: {
                normalizedRu: {
                    ...emptySeries('normalizedRu'),
                    available: true,
                    peak: 0,
                    points: [{ timestamp: 1000, value: 0 }],
                },
            },
        });
        expect(screen.getByTestId('metric-plot')).toBeVisible();
        update({ applicabilityByMetric: serverless, loading: true });
        expect(screen.queryByRole('button', { name: /^Normalized RU/ })).not.toBeInTheDocument();
        expect(screen.queryByTestId('metric-plot')).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Total request units trend' })).toBeVisible();
    });

    it('retains a real measured zero in both tile and chart', async () => {
        const user = userEvent.setup();
        renderMetrics({
            chartAffordances,
            applicabilityByMetric: provisioned,
            seriesByMetric: {
                totalRequestUnits: {
                    ...emptySeries('totalRequestUnits'),
                    available: true,
                    reason: undefined,
                    peak: 0,
                    points: [{ timestamp: 1000, value: 0 }],
                },
            },
        });
        const tile = metricTile('totalRequestUnits');
        expect(within(tile).getByText('0')).toBeVisible();
        await user.click(tile);
        expect(screen.getByTestId('metric-plot')).toHaveTextContent('"value":0');
        expect(
            within(screen.getByRole('region', { name: 'Total request units trend' })).queryByText('Not applicable'),
        ).not.toBeInTheDocument();
    });
});

it('uses the same selection for an applicable eye button and omits inapplicable eye buttons', async () => {
    const user = userEvent.setup();
    renderMetrics({ chartAffordances: true, applicabilityByMetric: serverless });
    const eye = screen.getByRole('button', { name: 'Show chart: Total requests' });
    expect(screen.queryByRole('button', { name: 'Show chart: Normalized RU' })).not.toBeInTheDocument();
    await user.click(eye);
    expect(eye).toHaveFocus();
    expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Total requests trend' })).toBeVisible();
});

it.each([
    ['noData', 'No telemetry available for this selection yet.'],
    ['rbac', 'Not enough permissions: your role is missing Monitoring Reader.'],
    ['unsupported', 'Telemetry unavailable for this API or SKU.'],
    ['error', 'Unable to load metric data. Use Refresh to try again.'],
] as const)('preserves the %s chart state rather than declaring inapplicability', (reason, text) => {
    renderMetrics({ seriesByMetric: { normalizedRu: emptySeries('normalizedRu', reason) } });
    expect(within(screen.getByRole('region', { name: 'Normalized RU trend' })).getByText(text)).toBeVisible();
    expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
});
