/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import type * as Recharts from 'recharts';
import { expect, it, vi } from 'vitest';
import { unavailableStorage } from '../../../../panels/accountOverview/metrics/storage';
import { type MetricSeriesResult, type StorageMeasurement } from '../../../api/types';
import { METRIC_VIEWS } from './descriptors';
import { MetricChart } from './MetricChart';

vi.mock('recharts', async (importOriginal) => ({
    ...(await importOriginal<typeof Recharts>()),
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
        cloneElement(children, { width: 800, height: 280 }),
}));

it.each([true, false])('exposes an asynchronous load failure as a status (storage: %s)', (isStorage) => {
    const descriptor = isStorage ? METRIC_VIEWS.dataIndexUsage : METRIC_VIEWS.totalRequests;
    const { rerender } = render(<MetricChart descriptor={descriptor} loading={true} timeRange="24H" />);
    const series: MetricSeriesResult = {
        metric: isStorage ? 'dataIndexUsage' : 'totalRequests',
        applicability: { status: 'applicable' },
        available: false,
        reason: 'error',
        points: [],
        timeRange: '24H',
        generatedAt: 1000,
        ...(isStorage ? { storage: unavailableStorage('error') } : {}),
    };
    rerender(<MetricChart descriptor={descriptor} loading={false} timeRange="24H" series={series} />);
    const status = screen.getByRole('status');
    expect(status).toBeVisible();
    expect(status).toHaveTextContent(
        isStorage
            ? /Storage unavailable\s*Data: Unable to load; indexes: Unable to load\./
            : 'Unable to load metric data. Use Refresh to try again.',
    );
});

it('renders isolated storage observations on both real chart lines without bridging a missing bucket', async () => {
    const first: StorageMeasurement = {
        data: { status: 'available', bytes: 100, timestamp: 1000 },
        index: { status: 'available', bytes: 10, timestamp: 1000 },
    };
    const last: StorageMeasurement = {
        data: { status: 'available', bytes: 200, timestamp: 3000 },
        index: { status: 'available', bytes: 20, timestamp: 3000 },
    };
    const { container } = render(
        <FluentProvider theme={webLightTheme}>
            <MetricChart
                descriptor={METRIC_VIEWS.dataIndexUsage}
                loading={false}
                timeRange="24H"
                series={{
                    metric: 'dataIndexUsage',
                    applicability: { status: 'applicable' },
                    available: true,
                    storage: last,
                    points: [
                        { timestamp: 1000, value: 110, storage: first },
                        { timestamp: 2000, storage: unavailableStorage('noData') },
                        { timestamp: 3000, value: 220, storage: last },
                    ],
                    timeRange: '24H',
                    generatedAt: 3000,
                }}
            />
        </FluentProvider>,
    );
    await waitFor(() => expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(4));
    expect(screen.getByText('Data')).toBeVisible();
    expect(screen.getByText('Indexes')).toBeVisible();
    expect(screen.getByRole('figure')).toHaveAccessibleName('Data + index usage');
    expect(screen.getByRole('figure')).toHaveAccessibleDescription(
        'Data: 200 B; indexes: 20 B. Data uses a solid line; indexes use a dashed line. Missing observations appear as gaps.',
    );
    expect(screen.queryByText(/Missing observations appear as gaps/)).not.toBeInTheDocument();
    expect(screen.queryByText('Data: 200 B; indexes: 20 B.')).not.toBeInTheDocument();
    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(curves).toHaveLength(2);
    for (const curve of curves) {
        expect(curve.getAttribute('d')?.match(/M/g)).toHaveLength(2);
        expect(curve.getAttribute('d')).not.toMatch(/L/);
    }
    const chart = screen.getByRole('application');
    expect(chart).toHaveAttribute('tabindex', '0');
    fireEvent.focus(chart);
    expect(await screen.findByText('Data: 100 B; indexes: 10 B.')).toBeVisible();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(await screen.findByText('Data: No data; indexes: No data.')).toBeVisible();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(await screen.findByText('Data: 200 B; indexes: 20 B.')).toBeVisible();
});

it.each(['data', 'index'] as const)(
    'marks an entirely missing %s series in the legend and shows partial details only in the tooltip',
    async (missing) => {
        const storage: StorageMeasurement = {
            data: { status: 'available', bytes: 100, timestamp: 1000 },
            index: { status: 'available', bytes: 10, timestamp: 1000 },
            [missing]: { status: 'unavailable', reason: 'rbac' },
        };
        const description =
            missing === 'data' ? 'Data: No permission; indexes: 10 B.' : 'Data: 100 B; indexes: No permission.';
        render(
            <FluentProvider theme={webLightTheme}>
                <MetricChart
                    descriptor={METRIC_VIEWS.dataIndexUsage}
                    loading={false}
                    timeRange="24H"
                    series={{
                        metric: 'dataIndexUsage',
                        applicability: { status: 'applicable' },
                        available: true,
                        storage,
                        points: [{ timestamp: 1000, storage }],
                        timeRange: '24H',
                        generatedAt: 1000,
                    }}
                />
            </FluentProvider>,
        );
        expect(await screen.findByText(`${missing === 'data' ? 'Data' : 'Indexes'} — No permission`)).toBeVisible();
        expect(screen.queryByText(description)).not.toBeInTheDocument();
        expect(screen.queryByText('Partial data')).not.toBeInTheDocument();
        fireEvent.focus(screen.getByRole('application'));
        expect(await screen.findByText(description)).toBeVisible();
        expect(screen.getByText('Partial data')).toBeVisible();
    },
);
