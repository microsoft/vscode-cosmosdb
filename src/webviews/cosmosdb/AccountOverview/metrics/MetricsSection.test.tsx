/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, type PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { type MetricKey } from '../../../api/types';
import { MetricsSection } from './MetricsSection';

// Selection is owned by MetricsSection; avoid Recharts' dependence on browser layout in jsdom.
vi.mock('./MetricChart', () => ({ MetricChart: () => null }));

const metrics = [
    { key: 'totalRequests', label: 'Total requests' },
    { key: 'serverLatency', label: 'Server-side latency' },
    { key: 'serviceAvailability', label: 'Service availability' },
    { key: 'normalizedRu', label: 'Normalized RU' },
] satisfies { key: MetricKey; label: string }[];

function createProps(): ComponentProps<typeof MetricsSection> {
    return {
        order: metrics.map(({ key }) => key),
        seriesByMetric: {},
        loading: false,
        timeRange: '24H',
        onTimeRangeChange: vi.fn(),
        containers: [],
        onSelectContainer: vi.fn(),
    };
}

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

function expectSelectedMetric(selected: MetricKey) {
    for (const { key, label } of metrics) {
        const tile = screen.getByRole('button', { name: new RegExp(`^${label}`) });
        expect(tile).toHaveTextContent(label);
        expect(tile).toHaveAccessibleName(new RegExp(`^${label}`));
        expect(tile).toHaveAttribute('aria-pressed', String(key === selected));
    }
}

describe('MetricsSection', () => {
    it('defaults to normalized RU even when it is not the first tile', () => {
        render(<MetricsSection {...createProps()} />, { wrapper: Wrapper });

        expectSelectedMetric('normalizedRu');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Normalized RU trend');
    });

    it.each(metrics.filter(({ key }) => key !== 'normalizedRu'))(
        'selects the $key tile and its trend heading on initial render',
        ({ key, label }) => {
            render(<MetricsSection {...createProps()} initialMetric={key} />, { wrapper: Wrapper });

            expectSelectedMetric(key);
            expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`${label} trend`);
        },
    );

    it('allows the user to select another tile after applying the initial metric', () => {
        render(<MetricsSection {...createProps()} initialMetric="totalRequests" />, { wrapper: Wrapper });
        expectSelectedMetric('totalRequests');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Total requests trend');

        fireEvent.click(screen.getByRole('button', { name: /^Server-side latency/ }));

        expectSelectedMetric('serverLatency');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Server-side latency trend');
    });

    it('preserves the user selection when metric data and the time range change', () => {
        const props = createProps();
        const { rerender } = render(<MetricsSection {...props} initialMetric="serviceAvailability" />, {
            wrapper: Wrapper,
        });
        expectSelectedMetric('serviceAvailability');
        fireEvent.click(screen.getByRole('button', { name: /^Total requests/ }));
        expectSelectedMetric('totalRequests');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Total requests trend');

        const updatedProps: ComponentProps<typeof MetricsSection> = {
            ...props,
            seriesByMetric: {
                totalRequests: {
                    metric: 'totalRequests',
                    available: true,
                    points: [{ timestamp: 1000, value: 42 }],
                    peak: 42,
                    timeRange: '24H',
                    generatedAt: 2000,
                },
            },
        };
        rerender(<MetricsSection {...updatedProps} initialMetric="serviceAvailability" />);

        expectSelectedMetric('totalRequests');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Total requests trend');
        expect(screen.getByRole('button', { name: /^Total requests/ })).toHaveTextContent('42');

        rerender(<MetricsSection {...updatedProps} initialMetric="serviceAvailability" timeRange="7D" />);

        expectSelectedMetric('totalRequests');
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Total requests trend');
        expect(screen.getByRole('button', { name: 'Show the last 7 days (7D)' })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });
});
