/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RANGE_CONFIG } from '../../../panels/accountOverview/services/shared';
import { type MetricPoint, type MetricSeriesResult } from '../../api/types';
import { metricSamples } from './overviewMetricsModel';
import { NORMALIZED_ATTENTION_PERCENT } from './overviewThroughputModel';

/** Bucket maxima estimate affected intervals, not continuous time above the guide. */
export function normalizedRuIntervals(series: MetricSeriesResult) {
    const { bucketMs, windowMs } = RANGE_CONFIG[series.timeRange];
    const end = series.generatedAt;
    const start = end - windowMs;
    const samples = new Map<number, number | undefined>();
    if (
        !series.available ||
        series.metric !== 'normalizedRu' ||
        !Number.isFinite(end) ||
        Number.isNaN(new Date(end).getTime())
    ) {
        return { points: [], aboveMs: undefined, observedMs: 0, windowMs };
    }
    for (const point of metricSamples(series, true)) {
        if (point.timestamp < start || point.timestamp + bucketMs > end) {
            continue;
        }
        const existing = samples.get(point.timestamp);
        samples.set(
            point.timestamp,
            existing === undefined ? point.value : Math.max(existing, point.value ?? existing),
        );
    }
    let observedMs = 0;
    let aboveMs = 0;
    let coveredUntil = start;
    const points: MetricPoint[] = [];
    for (const [timestamp, value] of samples) {
        const previous = points.at(-1);
        if (previous && timestamp - previous.timestamp > bucketMs) {
            points.push({ timestamp: previous.timestamp + bucketMs, value: undefined });
        }
        points.push({ timestamp, value });
        if (value !== undefined) {
            const duration = Math.max(0, timestamp + bucketMs - Math.max(timestamp, coveredUntil));
            observedMs += duration;
            if (value > NORMALIZED_ATTENTION_PERCENT) {
                aboveMs += duration;
            }
            coveredUntil = timestamp + bucketMs;
        }
    }
    return { points, aboveMs: observedMs > 0 ? aboveMs : undefined, observedMs, windowMs };
}
