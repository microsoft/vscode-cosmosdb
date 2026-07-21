/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    DEFAULT_ADVISORY_THRESHOLDS,
    DEFAULT_HEALTH_THRESHOLDS,
    DEFAULT_PARTITION_THRESHOLDS,
    type DerivedAdvisoryThresholds,
    type HealthThresholds,
    type PartitionThresholds,
} from '../../../accountOverview/services';

// ─── Router-side threshold preparation ──────────────────────────────────────────
//
// Reads the user-tunable `cosmosDB.accountOverview.*` settings into the plain
// threshold objects the pure service functions consume. This is data preparation
// (it touches the vscode config surface), so it lives on the router side rather
// than in the service.

/** Reads the per-row health thresholds from `cosmosDB.accountOverview.*`, falling back to defaults. */
export function readHealthThresholds(): HealthThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    return {
        criticalRuPercent:
            config.get<number>('health.criticalRuPercent') ?? DEFAULT_HEALTH_THRESHOLDS.criticalRuPercent,
        warningRuPercent: config.get<number>('health.warningRuPercent') ?? DEFAULT_HEALTH_THRESHOLDS.warningRuPercent,
    };
}

/**
 * Reads the partition-distribution thresholds, falling back to defaults. The RU saturation/headroom marks and the
 * storage balance ratio are shared with the derived-advisory engine (`advisories.partitionSaturationPercent`,
 * `advisories.partitionHeadroomPercent`, `advisories.storageSkewBalanceRatio`) so the heatmap and the
 * HotPartitionRisk / StorageSkewRisk advisories flag the same partitions; only the ranked-list length is
 * partition-specific (`partition.topN`).
 */
export function readPartitionThresholds(): PartitionThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    const topN = config.get<number>('partition.topN');
    const saturationPercent = config.get<number>('advisories.partitionSaturationPercent');
    const headroomPercent = config.get<number>('advisories.partitionHeadroomPercent');
    const skewBalanceRatio = config.get<number>('advisories.storageSkewBalanceRatio');
    return {
        saturationPercent:
            saturationPercent !== undefined && saturationPercent > 0
                ? saturationPercent
                : DEFAULT_PARTITION_THRESHOLDS.saturationPercent,
        headroomPercent:
            headroomPercent !== undefined && headroomPercent > 0
                ? headroomPercent
                : DEFAULT_PARTITION_THRESHOLDS.headroomPercent,
        skewBalanceRatio:
            skewBalanceRatio !== undefined && skewBalanceRatio > 0
                ? skewBalanceRatio
                : DEFAULT_PARTITION_THRESHOLDS.skewBalanceRatio,
        topN: topN !== undefined && topN >= 1 ? Math.floor(topN) : DEFAULT_PARTITION_THRESHOLDS.topN,
    };
}

/** Reads the derived-advisory thresholds from `cosmosDB.accountOverview.*`, falling back to defaults. */
export function readAdvisoryThresholds(): DerivedAdvisoryThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    const positive = (value: number | undefined, fallback: number): number =>
        value !== undefined && value >= 0 ? value : fallback;
    return {
        // HotPartitionRisk (DX-006) and SustainedThrottlingInRegion (DX-005) share the per-partition saturation and
        // headroom marks with the heatmap so both flag the same partitions.
        partitionSaturationPercent: positive(
            config.get<number>('advisories.partitionSaturationPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.partitionSaturationPercent,
        ),
        partitionHeadroomPercent: positive(
            config.get<number>('advisories.partitionHeadroomPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.partitionHeadroomPercent,
        ),
        throttleRatePercent: positive(
            config.get<number>('advisories.throttleRatePercent'),
            DEFAULT_ADVISORY_THRESHOLDS.throttleRatePercent,
        ),
        overProvisioningBandPercent: positive(
            config.get<number>('advisories.overProvisioningBandPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.overProvisioningBandPercent,
        ),
        autoscaleMaxPercent: positive(
            config.get<number>('advisories.autoscaleMaxPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.autoscaleMaxPercent,
        ),
        autoscaleAvgPercent: positive(
            config.get<number>('advisories.autoscaleAvgPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.autoscaleAvgPercent,
        ),
        autoscalePeakToAvgRatio: positive(
            config.get<number>('advisories.autoscalePeakToAvgRatio'),
            DEFAULT_ADVISORY_THRESHOLDS.autoscalePeakToAvgRatio,
        ),
        storageGrowthHorizonDays: positive(
            config.get<number>('advisories.storageGrowthHorizonDays'),
            DEFAULT_ADVISORY_THRESHOLDS.storageGrowthHorizonDays,
        ),
        storageSkewBalanceRatio: positive(
            config.get<number>('advisories.storageSkewBalanceRatio'),
            DEFAULT_ADVISORY_THRESHOLDS.storageSkewBalanceRatio,
        ),
        indexingUsageRatio: positive(
            config.get<number>('advisories.indexingUsageRatio'),
            DEFAULT_ADVISORY_THRESHOLDS.indexingUsageRatio,
        ),
    };
}
