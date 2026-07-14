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
    const growthGB = config.get<number>('health.storageGrowthWarningGB');
    return {
        criticalRuPercent:
            config.get<number>('health.criticalRuPercent') ?? DEFAULT_HEALTH_THRESHOLDS.criticalRuPercent,
        warningRuPercent: config.get<number>('health.warningRuPercent') ?? DEFAULT_HEALTH_THRESHOLDS.warningRuPercent,
        storageGrowthWarningBytes:
            growthGB !== undefined && growthGB >= 0
                ? growthGB * 1024 * 1024 * 1024
                : DEFAULT_HEALTH_THRESHOLDS.storageGrowthWarningBytes,
    };
}

/** Reads the partition-skew thresholds from `cosmosDB.accountOverview.partition.*`, falling back to defaults. */
export function readPartitionThresholds(): PartitionThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    const topN = config.get<number>('partition.topN');
    return {
        hotRuSharePercent:
            config.get<number>('partition.hotRuSharePercent') ?? DEFAULT_PARTITION_THRESHOLDS.hotRuSharePercent,
        skewedStorageSharePercent:
            config.get<number>('partition.skewedStorageSharePercent') ??
            DEFAULT_PARTITION_THRESHOLDS.skewedStorageSharePercent,
        topN: topN !== undefined && topN >= 1 ? Math.floor(topN) : DEFAULT_PARTITION_THRESHOLDS.topN,
    };
}

/** Reads the derived-advisory thresholds from `cosmosDB.accountOverview.*`, falling back to defaults. */
export function readAdvisoryThresholds(): DerivedAdvisoryThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    const positive = (value: number | undefined, fallback: number): number =>
        value !== undefined && value >= 0 ? value : fallback;
    return {
        // HotPartitionRisk reuses the hot-partition share so the heatmap and the advisory agree.
        hotPartitionSharePercent: positive(
            config.get<number>('partition.hotRuSharePercent'),
            DEFAULT_ADVISORY_THRESHOLDS.hotPartitionSharePercent,
        ),
        throttlingMinMinutes: positive(
            config.get<number>('advisories.throttlingMinMinutes'),
            DEFAULT_ADVISORY_THRESHOLDS.throttlingMinMinutes,
        ),
        overProvisioningPeakPercent: positive(
            config.get<number>('advisories.overProvisioningPeakPercent'),
            DEFAULT_ADVISORY_THRESHOLDS.overProvisioningPeakPercent,
        ),
        autoscaleCoefficientOfVariation: positive(
            config.get<number>('advisories.autoscaleCoefficientOfVariation'),
            DEFAULT_ADVISORY_THRESHOLDS.autoscaleCoefficientOfVariation,
        ),
        indexingUsageRatio: positive(
            config.get<number>('advisories.indexingUsageRatio'),
            DEFAULT_ADVISORY_THRESHOLDS.indexingUsageRatio,
        ),
    };
}
