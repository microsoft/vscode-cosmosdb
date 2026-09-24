/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { OverviewAnalyticsTiles } from './OverviewAnalyticsTiles';
import { type OverviewAnalyticsState } from './useOverviewAnalytics';

const data: NonNullable<OverviewAnalyticsState['data']> = {
    timeRange: '24H',
    generatedAt: 1000,
    windowStart: 0,
    windowEnd: 1000,
    throttling: { available: true, totalRequests: 100, throttledRequests: 2, ratePercent: 2 },
    consumedRu: { available: true, bucketSeconds: 300, peakBucketAverageRuPerSecond: 50 },
    resources: {},
    resourcesComplete: true,
};

describe('Overview analytics tiles', () => {
    it('shows measured rates, counts and explicitly bucket-average RU/s', () => {
        render(<OverviewAnalyticsTiles analytics={{ data, loading: false, failed: false }} />);
        expect(screen.getByText('2%')).toBeInTheDocument();
        expect(screen.getByText('2 of 100 measured requests returned 429.')).toBeInTheDocument();
        expect(screen.getByText('50 RU/s')).toBeInTheDocument();
        expect(
            screen.getByText('Maximum bucket RU divided by 300 seconds; not an instantaneous peak.'),
        ).toBeInTheDocument();
        expect(screen.getByText(/Rate and RU\/s use complete buckets/)).toBeInTheDocument();
    });

    it('does not render unavailable or loading data as measured zero or stale statistics', () => {
        const { rerender } = render(
            <OverviewAnalyticsTiles
                analytics={{
                    data: {
                        ...data,
                        throttling: { available: false, totalRequests: 0, throttledRequests: 0, reason: 'noData' },
                        consumedRu: { available: false, reason: 'rbac', bucketSeconds: 300 },
                    },
                    loading: false,
                    failed: false,
                }}
            />,
        );
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
        expect(screen.queryByText('0 RU/s')).not.toBeInTheDocument();
        rerender(<OverviewAnalyticsTiles analytics={{ data, loading: true, failed: false }} />);
        expect(screen.queryByText('2%')).not.toBeInTheDocument();
        expect(screen.queryByText('50 RU/s')).not.toBeInTheDocument();
        expect(screen.getAllByText('Loading…')).toHaveLength(2);
    });

    it('reports transport failure explicitly with a retry path', () => {
        render(<OverviewAnalyticsTiles analytics={{ loading: false, failed: true }} />);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Additional throughput analytics could not be loaded. Use Refresh to retry.',
        );
    });
});
