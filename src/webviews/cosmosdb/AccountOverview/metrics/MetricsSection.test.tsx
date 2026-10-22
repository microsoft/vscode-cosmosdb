/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, tokens, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountMetricApplicability } from '../../../../panels/accountOverview/metrics/contracts';
import { type MetricKey, type MetricPoint, type MetricSeriesResult, type StorageMeasurement } from '../../../api/types';
import { METRIC_ORDER, METRIC_VIEWS, metricInapplicabilityExplanation } from './descriptors';
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
const normalizedExplanation = metricInapplicabilityExplanation('serverlessNormalizedRu');
const throughputExplanation = metricInapplicabilityExplanation('serverlessProvisionedThroughput');

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
    it('puts only inapplicable tiles last, retaining original order, and defaults to consumed RU', () => {
        renderMetrics({ chartAffordances, applicabilityByMetric: serverless, loading: true });
        expect(tileLabels()).toEqual([
            'Data + index usage',
            'Document count',
            'Total requests',
            'Total request units',
            'Metadata requests',
            'Server-side latency',
            'Service availability',
            'Normalized RU',
            'Provisioned throughput',
        ]);
        expect(metricTile('totalRequestUnits')).toHaveAttribute('aria-pressed', 'true');
        for (const metric of ['normalizedRu', 'provisionedThroughput'] as const) {
            const tile = metricTile(metric);
            expect(tile).toHaveTextContent('—Not applicable');
            expect(tile).not.toHaveTextContent('Loading');
            expect(tile).not.toBeDisabled();
        }
        expect(metricTile('normalizedRu')).toHaveAccessibleDescription(`State ${normalizedExplanation}`);
        expect(metricTile('provisionedThroughput')).toHaveAccessibleDescription(`State ${throughputExplanation}`);
    });

    it('uses the same explanatory state for keyboard activation and mouse selection', async () => {
        const user = userEvent.setup();
        renderMetrics({ chartAffordances, applicabilityByMetric: serverless, loading: true });
        const tile = metricTile('normalizedRu');
        act(() => tile.focus());
        await user.keyboard('{Enter}');
        expect(tile).toHaveFocus();
        expect(tile).toHaveAttribute('aria-pressed', 'true');
        const chart = screen.getByRole('region', { name: 'Normalized RU trend' });
        expect(within(chart).getByText('Not applicable')).toBeVisible();
        expect(within(chart).getByText(normalizedExplanation)).toBeVisible();
        expect(within(chart).queryByRole('progressbar')).not.toBeInTheDocument();
        expect(within(chart).queryByTestId('metric-plot')).not.toBeInTheDocument();
        expect(within(chart).queryByText(/telemetry.*yet/)).not.toBeInTheDocument();
        await user.click(metricTile('provisionedThroughput'));
        expect(
            within(screen.getByRole('region', { name: 'Provisioned throughput trend' })).getByText(
                throughputExplanation,
            ),
        ).toBeVisible();
    });

    it('separates the Not applicable chart status from its explanation into readable blocks', () => {
        renderMetrics({ chartAffordances, applicabilityByMetric: serverless, requestedMetric: 'normalizedRu' });
        const chart = screen.getByRole('region', { name: 'Normalized RU trend' });
        const status = within(chart).getByText('Not applicable');
        const explanation = within(chart).getByText(normalizedExplanation);
        expect(status.tagName).toBe('P');
        expect(explanation.tagName).toBe('P');
        expect(status).toHaveStyle({ display: 'block' });
        expect(explanation).toHaveStyle({ display: 'block' });
        expect(status.parentElement).toHaveStyle({
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.spacingVerticalS,
            overflowWrap: 'anywhere',
        });
        expect(chart).toHaveAccessibleName('Normalized RU trend');
        expect(chart).toHaveFocus();
        expect(status).not.toHaveAttribute('aria-hidden');
        expect(explanation).not.toHaveAttribute('aria-hidden');
    });

    it('shows the reason on hover and keyboard focus without replacing the visible accessible name', async () => {
        const user = userEvent.setup();
        renderMetrics({ chartAffordances, applicabilityByMetric: serverless });
        const tile = metricTile('normalizedRu');
        expect(tile).toHaveAccessibleName('Normalized RU — Not applicable');
        const descriptions = tile.getAttribute('aria-describedby')!.split(' ');
        expect(descriptions).toHaveLength(2);
        expect(document.getElementById(descriptions[0])).toHaveTextContent('State');
        expect(document.getElementById(descriptions[1])).toHaveTextContent(normalizedExplanation);
        await user.hover(tile);
        expect(await screen.findByRole('tooltip')).toHaveTextContent(normalizedExplanation);
        await user.unhover(tile);
        const provisionedTile = metricTile('provisionedThroughput');
        fireEvent.keyDown(document, { key: 'Tab' });
        act(() => provisionedTile.focus());
        await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(throughputExplanation));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        expect(provisionedTile).toHaveFocus();
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
        await user.click(metricTile('normalizedRu'));
        const focused = metricTile('normalizedRu');
        update({ applicabilityByMetric: { ...serverless }, loading: true, timeRange: '7D' });
        expect(focused).toHaveFocus();
        expect(focused).toHaveAttribute('aria-pressed', 'true');
        expect(
            within(screen.getByRole('region', { name: 'Normalized RU trend' })).getByText('Not applicable'),
        ).toBeVisible();
        update({ applicabilityByMetric: provisioned, loading: false });
        expect(metricTile('normalizedRu')).toBe(focused);
        expect(focused).toHaveFocus();
        expect(focused).toHaveAttribute('aria-pressed', 'true');
    });

    it('does not overwrite a user selection made before metadata arrives', async () => {
        const user = userEvent.setup();
        const { update } = renderMetrics({ chartAffordances, loading: true });
        await user.click(metricTile('normalizedRu'));
        const focused = metricTile('normalizedRu');
        update({ applicabilityByMetric: serverless, loading: true });
        expect(metricTile('normalizedRu')).toBe(focused);
        expect(focused).toHaveFocus();
        expect(focused).toHaveAttribute('aria-pressed', 'true');
    });

    it('honors explicit navigation to an inapplicable metric without redirecting', () => {
        renderMetrics({
            chartAffordances,
            applicabilityByMetric: serverless,
            requestedMetric: 'provisionedThroughput',
        });
        expect(metricTile('provisionedThroughput')).toHaveAttribute('aria-pressed', 'true');
        const chart = screen.getByRole('region', { name: 'Provisioned throughput trend' });
        expect(chart).toHaveFocus();
        expect(within(chart).getByText(throughputExplanation)).toBeVisible();
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
        expect(metricTile('normalizedRu')).toHaveTextContent('—Not applicable');
        expect(screen.queryByTestId('metric-plot')).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(
            within(screen.getByRole('region', { name: 'Normalized RU trend' })).getByText(normalizedExplanation),
        ).toBeVisible();
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

it('uses the same selection and accessible explanation for the eye button', async () => {
    const user = userEvent.setup();
    renderMetrics({ chartAffordances: true, applicabilityByMetric: serverless });
    const eye = screen.getByRole('button', { name: 'Show chart: Normalized RU' });
    expect(eye).toHaveAccessibleDescription(`State ${normalizedExplanation}`);
    await user.click(eye);
    expect(eye).toHaveFocus();
    expect(eye).toHaveAttribute('aria-pressed', 'true');
    expect(
        within(screen.getByRole('region', { name: 'Normalized RU trend' })).getByText(normalizedExplanation),
    ).toBeVisible();
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
