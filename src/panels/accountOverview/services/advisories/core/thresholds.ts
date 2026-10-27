/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RangeConfig, type TimeRange } from '../../shared';
import { DAY, GIB, HOUR, MINUTE } from '../../units';
import { type DerivedAdvisoryThresholds } from './types';

/** A diagnostic lookback with its existing dashboard range label, independent of chart bucket defaults. */
interface DiagnosticRange extends RangeConfig {
    timeRange: TimeRange;
}

/**
 * Internal Derived Advisory policy, grouped by signal/rule family and maintained against CODA.
 * VS Code settings must never override these values. User Health/view defaults live in healthPolicy.ts instead.
 * Known resource ages and finite observation counts gate recommendations; unknown ages do not imply young resources.
 */
export const DIAGNOSTIC_POLICY = {
    partitionSaturation: {
        minResourceAgeDays: 1,
        percentile: 99,
        saturationPercent: 90,
        headroomPercent: 70,
        throttleRatePercent: 1,
        minHotPartitions: 2,
        observation: {
            timeRange: '7D',
            windowMs: 7 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        } satisfies DiagnosticRange,
    },
    underProvisioning: {
        minRequests: 1_000,
        highThrottleRatePercent: 20,
        mediumThrottleRatePercent: 5,
    },
    // DX-001 and DX-011 share the right-sizing band, peak guard and headroom policy.
    overProvisioning: {
        minResourceAgeDays: 7,
        minSamples: 24,
        bandPercent: 30,
        peakGuardPercent: 90,
        headroomMultiplier: 1.3,
        percentile: 99,
        // Also feeds the manual-to-autoscale duty cycle. The range label is only a chart-adapter compatibility value.
        observation: {
            timeRange: '7D',
            windowMs: 30 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        } satisfies DiagnosticRange,
    },
    capacityMateriality: {
        highPercent: 5,
        mediumPercent: 1,
        absoluteHighRu: 5000,
        absoluteMediumRu: 1000,
    },
    autoscaleCandidate: {
        maxPercent: 40,
        avgPercent: 30,
        peakToAvgRatio: 5,
    },
    // AutoscaledRU feeds both max-over-provisioning and autoscale-to-manual.
    autoscaleUtilization: {
        minResourceAgeDays: 7,
        minSamples: 24,
        observation: { windowMs: 30 * DAY, interval: 'PT1H', bucketMs: HOUR } satisfies RangeConfig,
    },
    autoscaleToManual: {
        avgPercent: 66,
        peakToAvgRatio: 1.3,
    },
    idle: {
        minResourceAgeDays: 7,
        peakRuPerBucket: 50,
        observation: { windowMs: 30 * DAY, interval: 'PT5M', bucketMs: 5 * MINUTE } satisfies RangeConfig,
    },
    serverless: {
        sporadicRatio: 0.1,
        peakFloorRuPerSec: 10,
        peakCeilingRuPerSec: 5000,
        minSamples: 24,
        observation: { windowMs: 30 * DAY, interval: 'PT1H', bucketMs: HOUR } satisfies RangeConfig,
    },
    serverlessThrottling: {
        minRequests: 1000,
        throttleRatePercent: 1,
        highThrottleRatePercent: 20,
        mediumThrottleRatePercent: 5,
        observation: {
            timeRange: '7D',
            windowMs: 7 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        } satisfies DiagnosticRange,
    },
    storageGrowth: {
        horizonDays: 180,
        minMaterialBytes: 1 * GIB,
        minSlopeBytesPerDay: 0.1 * GIB,
        minSamples: 2,
        highDays: 30,
        mediumDays: 90,
        observation: {
            timeRange: '7D',
            windowMs: 30 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        } satisfies DiagnosticRange,
    },
    storageSkew: {
        minResourceAgeDays: 1,
        balanceRatio: 0.7,
        minPartitions: 2,
        minBusiestBytes: 1 * GIB,
        highBytes: 40 * GIB,
        mediumBytes: 25 * GIB,
        observation: {
            timeRange: '7D',
            windowMs: 7 * DAY,
            interval: 'PT1H',
            bucketMs: HOUR,
        } satisfies DiagnosticRange,
    },
    indexing: {
        usageRatio: 0.3,
    },
    partitionMerge: {
        mediumExcessRatio: 2,
        countObservation: { windowMs: 6 * HOUR, interval: 'PT5M', bucketMs: 5 * MINUTE } satisfies RangeConfig,
    },
    // Log queries aggregate raw events over this window, not hourly buckets.
    logs: {
        windowMs: DAY,
    },
    crossPartition: {
        minQueries: 50,
        fanoutThreshold: 1.5,
        highPercent: 30,
        mediumPercent: 10,
    },
    shardKey: {
        structuralPercent: 60,
        minPartitions: 2,
        highPercent: 80,
    },
    ingestion: {
        writeRuPercentFloor: 80,
        throttleRatePercent: 10,
        highPercent: 20,
        minRequests: 1000,
        burstInterval: '1m',
    },
    sharedThroughput: {
        minRequests: 100,
        minActiveCollections: 2,
        poolThrottlePercent: 5,
        dominancePercent: 60,
        victimThrottlePercent: 5,
        victimSharePercent: 20,
    },
    expensiveConsistency: {
        minRegions: 2,
    },
    multiRegionWrite: {
        minWriteRegions: 2,
    },
} as const;

/** Flat detector inputs derived only from the internal policy, never from VS Code settings. */
export const DEFAULT_ADVISORY_THRESHOLDS: DerivedAdvisoryThresholds = {
    partitionSaturationPercent: DIAGNOSTIC_POLICY.partitionSaturation.saturationPercent,
    partitionHeadroomPercent: DIAGNOSTIC_POLICY.partitionSaturation.headroomPercent,
    throttleRatePercent: DIAGNOSTIC_POLICY.partitionSaturation.throttleRatePercent,
    overProvisioningBandPercent: DIAGNOSTIC_POLICY.overProvisioning.bandPercent,
    autoscaleMaxPercent: DIAGNOSTIC_POLICY.autoscaleCandidate.maxPercent,
    autoscaleAvgPercent: DIAGNOSTIC_POLICY.autoscaleCandidate.avgPercent,
    autoscalePeakToAvgRatio: DIAGNOSTIC_POLICY.autoscaleCandidate.peakToAvgRatio,
    storageGrowthHorizonDays: DIAGNOSTIC_POLICY.storageGrowth.horizonDays,
    storageSkewBalanceRatio: DIAGNOSTIC_POLICY.storageSkew.balanceRatio,
    indexingUsageRatio: DIAGNOSTIC_POLICY.indexing.usageRatio,
    idlePeakRuPerBucket: DIAGNOSTIC_POLICY.idle.peakRuPerBucket,
    autoscaleToManualAvgPercent: DIAGNOSTIC_POLICY.autoscaleToManual.avgPercent,
    autoscaleToManualPeakToAvgRatio: DIAGNOSTIC_POLICY.autoscaleToManual.peakToAvgRatio,
    serverlessSporadicRatio: DIAGNOSTIC_POLICY.serverless.sporadicRatio,
    serverlessPeakFloorRuPerSec: DIAGNOSTIC_POLICY.serverless.peakFloorRuPerSec,
    serverlessPeakCeilingRuPerSec: DIAGNOSTIC_POLICY.serverless.peakCeilingRuPerSec,
    // Tier-2 (Log Analytics) — CODA-calibrated (cross_partition_query.py, shard_key_misalignment.py,
    // uncontrolled_ingestion.py, shared_throughput.py).
    crossPartitionMinQueries: DIAGNOSTIC_POLICY.crossPartition.minQueries,
    crossPartitionFanoutThreshold: DIAGNOSTIC_POLICY.crossPartition.fanoutThreshold,
    crossPartitionHighPct: DIAGNOSTIC_POLICY.crossPartition.highPercent,
    crossPartitionMedPct: DIAGNOSTIC_POLICY.crossPartition.mediumPercent,
    shardKeyStructuralPct: DIAGNOSTIC_POLICY.shardKey.structuralPercent,
    shardKeyHighPct: DIAGNOSTIC_POLICY.shardKey.highPercent,
    ingestionWriteRuPctFloor: DIAGNOSTIC_POLICY.ingestion.writeRuPercentFloor,
    ingestionThrottleRatePct: DIAGNOSTIC_POLICY.ingestion.throttleRatePercent,
    ingestionHighPct: DIAGNOSTIC_POLICY.ingestion.highPercent,
    ingestionMinRequests: DIAGNOSTIC_POLICY.ingestion.minRequests,
    sharedThroughputMinRequests: DIAGNOSTIC_POLICY.sharedThroughput.minRequests,
    sharedThroughputPoolThrottlePct: DIAGNOSTIC_POLICY.sharedThroughput.poolThrottlePercent,
    sharedThroughputDominancePct: DIAGNOSTIC_POLICY.sharedThroughput.dominancePercent,
    sharedThroughputVictimThrottlePct: DIAGNOSTIC_POLICY.sharedThroughput.victimThrottlePercent,
    sharedThroughputVictimSharePct: DIAGNOSTIC_POLICY.sharedThroughput.victimSharePercent,
};
