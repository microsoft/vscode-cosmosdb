/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import { type InventoryContainerRow } from '../inventory';
import { roundMonthlySavings } from './core/helpers';
import { type CostFailureKind, type CostSourceStatus, type DerivedAdvisory } from './core/types';
import { getBackupCostEstimate } from './fetchers/backupCost';
import { classifyCostFailure, getThroughputRate, type CostContext } from './fetchers/costManagement';

export function recoverableCapacity(advisory: DerivedAdvisory): number | undefined {
    if (advisory.supersededBy || advisory.actionEligibility === 'blocked') {
        return undefined;
    }
    let value: unknown;
    switch (advisory.rule) {
        case 'OverProvisioning':
        case 'IdleContainer':
            value = advisory.evidence?.recoverableRu;
            break;
        case 'AutoscaleMaxOverProvisioned':
            value = advisory.evidence?.recoverableIdleFloorRu;
            break;
        case 'MultiRegionWriteAntipattern':
            value =
                advisory.evidence?.regionalCapacityQuantified === true
                    ? advisory.evidence.removableExtraRegionRu
                    : undefined;
            break;
        default:
            return undefined;
    }
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Enrichment follows supersession. Independent read failures retain every qualitative/capacity finding. */
export async function enrichAdvisoryCosts(params: {
    advisories: DerivedAdvisory[];
    cosmosClient: CosmosDBManagementClient;
    monitorClient: MonitorClient;
    context?: CostContext;
    accountId: string;
    inventoryRows?: readonly InventoryContainerRow[];
    inventoryCostFailure?: CostFailureKind;
    now: number;
}): Promise<CostSourceStatus | undefined> {
    const { advisories, cosmosClient, monitorClient, context, accountId, inventoryRows, now } = params;
    const capacity = advisories.flatMap((advisory) => {
        const ru = recoverableCapacity(advisory);
        return ru === undefined ? [] : [{ advisory, ru }];
    });
    const backup = advisories.find((advisory) => advisory.rule === 'PaidContinuousBackup' && !advisory.supersededBy);
    if (capacity.length === 0 && !backup) {
        return undefined;
    }
    const failures: CostSourceStatus['failures'] = [];
    if (capacity.length > 0) {
        if (!context) {
            failures.push({ operation: 'throughput', kind: 'notConfigured' });
        } else {
            try {
                const rate = await getThroughputRate(cosmosClient, context, accountId, now);

                for (const { advisory, ru } of capacity) {
                    const amount = ru * rate.perRuMonth;
                    if (!Number.isFinite(amount)) {
                        if (!failures.some((failure) => failure.operation === 'throughput')) {
                            failures.push({ operation: 'throughput', kind: 'invalidData' });
                        }
                        continue;
                    }

                    const monthlyAmount = roundMonthlySavings(amount);
                    if (monthlyAmount > 0) {
                        advisory.costEstimate = {
                            basis: 'customerAmortizedBill',
                            monthlyAmount,
                            currency: rate.currency,
                            recoverableRu: ru,
                            rate,
                        };
                    }
                }
            } catch (error) {
                failures.push({ operation: 'throughput', kind: classifyCostFailure(error) });
            }
        }
    }
    if (backup) {
        if (!context) {
            failures.push({ operation: 'backup', kind: 'notConfigured' });
        } else if (params.inventoryCostFailure) {
            failures.push({ operation: 'backup', kind: params.inventoryCostFailure });
        } else {
            try {
                backup.costEstimate = await getBackupCostEstimate(
                    cosmosClient,
                    monitorClient,
                    context,
                    accountId,
                    inventoryRows,
                    now,
                );
            } catch (error) {
                failures.push({ operation: 'backup', kind: classifyCostFailure(error) });
            }
        }
    }
    return { available: failures.length === 0, failures };
}
