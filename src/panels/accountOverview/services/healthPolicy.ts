/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type HealthThresholds } from './inventoryMetrics';
import { type PartitionThresholds } from './partitionHealth';
import { type RangeConfig } from './shared';
import { DAY, GIB, HOUR, MINUTE } from './units';

/** Health thresholds and partition-view defaults, independent of Settings exposure and Derived Advisory policy. */
export const OVERVIEW_DEFAULTS = {
    health: {
        criticalRuPercent: 90,
        warningRuPercent: 80,
    } satisfies HealthThresholds,
    partition: {
        saturationPercent: 90,
        headroomPercent: 70,
        skewBalanceRatio: 0.7,
        topN: 5,
    } satisfies PartitionThresholds,
} as const;

/** Health observation and evidence rules, independent of Derived Advisory thresholds. */
export const HEALTH_POLICY = {
    sustainedThrottling: {
        shareThreshold: 0.01,
        minDurationMs: 5 * MINUTE,
        maxGapBuckets: 1.5,
        observation: { windowMs: HOUR, interval: 'PT1M', bucketMs: MINUTE } satisfies RangeConfig,
    },
    partition: {
        percentile: 99,
        minPartitions: 2,
        minBusiestBytes: GIB,
    },
    inventoryStorage: {
        observation: { windowMs: 7 * DAY, interval: 'PT1H', bucketMs: HOUR } satisfies RangeConfig,
    },
} as const;
