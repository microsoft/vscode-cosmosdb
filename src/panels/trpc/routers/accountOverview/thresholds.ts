/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    DEFAULT_HEALTH_THRESHOLDS,
    DEFAULT_PARTITION_THRESHOLDS,
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

/** Reads user Health/view controls only, never the former advisories.* keys or Derived Advisory policy. */
export function readPartitionThresholds(): PartitionThresholds {
    const config = vscode.workspace.getConfiguration('cosmosDB.accountOverview');
    const topN = config.get<number>('partition.topN');
    const saturationPercent = config.get<number>('health.partitionSaturationPercent');
    const headroomPercent = config.get<number>('health.partitionHeadroomPercent');
    const skewBalanceRatio = config.get<number>('health.storageSkewBalanceRatio');
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
