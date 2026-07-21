/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DEFAULT_PARTITION_HEADROOM_PCT,
    DEFAULT_PARTITION_SATURATION_PCT,
    DEFAULT_THROTTLE_RATE_PCT,
} from '../../shared';
import { type DerivedAdvisoryThresholds } from './types';

export const DEFAULT_ADVISORY_THRESHOLDS: DerivedAdvisoryThresholds = {
    partitionSaturationPercent: DEFAULT_PARTITION_SATURATION_PCT,
    partitionHeadroomPercent: DEFAULT_PARTITION_HEADROOM_PCT,
    throttleRatePercent: DEFAULT_THROTTLE_RATE_PCT,
    overProvisioningBandPercent: 30,
    autoscaleMaxPercent: 40,
    autoscaleAvgPercent: 30,
    autoscalePeakToAvgRatio: 5,
    storageGrowthHorizonDays: 180,
    storageSkewBalanceRatio: 0.7,
    indexingUsageRatio: 0.3,
    idlePeakRuPerBucket: 50,
    autoscaleToManualAvgPercent: 66,
    autoscaleToManualPeakToAvgRatio: 1.3,
    serverlessSporadicRatio: 0.1,
    serverlessPeakFloorRuPerSec: 10,
    serverlessPeakCeilingRuPerSec: 5000,
    // Tier-2 (Log Analytics) — CODA-calibrated (cross_partition_query.py, shard_key_misalignment.py,
    // uncontrolled_ingestion.py, shared_throughput.py). Internal-guidance defaults, tunable via advisories.*.
    crossPartitionMinQueries: 50,
    crossPartitionFanoutThreshold: 1.5,
    crossPartitionHighPct: 30,
    crossPartitionMedPct: 10,
    shardKeyStructuralPct: 60,
    shardKeyHighPct: 80,
    ingestionWriteRuPctFloor: 80,
    ingestionThrottleRatePct: 10,
    ingestionHighPct: 20,
    ingestionMinRequests: 1000,
    sharedThroughputMinRequests: 100,
    sharedThroughputPoolThrottlePct: 5,
    sharedThroughputDominancePct: 60,
    sharedThroughputVictimThrottlePct: 5,
    sharedThroughputVictimSharePct: 20,
};
