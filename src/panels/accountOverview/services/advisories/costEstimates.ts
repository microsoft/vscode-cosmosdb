/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import { type InventoryContainerRow } from '../inventory';
import { type CostSourceStatus, type DerivedAdvisory } from './core/types';
import { getBackupCostEstimate } from './fetchers/backupCost';
import { classifyCostFailure, CostEvidenceError, getThroughputRate, type CostContext } from './fetchers/costManagement';

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
            const regions = context.locationNames.map((name) => name.replace(/\s+/g, '').toLowerCase());
            const regionCount =
                regions.length > 0 && regions.every(Boolean) && new Set(regions).size === regions.length
                    ? regions.length
                    : undefined;
            const regionalCapacity = capacity
                .map(({ advisory, ru }) => {
                    if (advisory.rule === 'MultiRegionWriteAntipattern') {
                        return { advisory, ru, regionalFootprint: null };
                    }
                    return regionCount === undefined
                        ? undefined
                        : {
                              advisory,
                              ru: ru * regionCount,
                              regionalFootprint: { regionCount, recoverableRuPerRegion: ru },
                          };
                })
                .filter((item) => item !== undefined);
            if (regionalCapacity.length < capacity.length) {
                failures.push({ operation: 'throughput', kind: 'noData' });
            }
            if (regionalCapacity.length > 0) {
                try {
                    if (regionalCapacity.some(({ ru }) => !Number.isFinite(ru))) {
                        throw new CostEvidenceError('invalidData');
                    }
                    const rate = await getThroughputRate(cosmosClient, context, accountId, now);
                    const amounts = regionalCapacity.map(({ ru }) => ru * rate.perRuMonth);
                    if (amounts.some((amount) => !Number.isFinite(amount) || amount <= 0)) {
                        throw new CostEvidenceError('invalidData');
                    }
                    for (const [index, { advisory, ru, regionalFootprint }] of regionalCapacity.entries()) {
                        advisory.costEstimate = {
                            basis: 'customerAmortizedBill',
                            monthlyAmount: amounts[index],
                            currency: rate.currency,
                            recoverableRu: ru,
                            regionalFootprint,
                            rate,
                        };
                    }
                } catch (error) {
                    const kind = classifyCostFailure(error);
                    if (!failures.some((failure) => failure.operation === 'throughput' && failure.kind === kind)) {
                        failures.push({ operation: 'throughput', kind });
                    }
                }
            }
        }
    }
    if (backup) {
        if (!context) {
            failures.push({ operation: 'backup', kind: 'notConfigured' });
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
