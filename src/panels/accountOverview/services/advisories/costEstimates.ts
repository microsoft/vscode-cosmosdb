/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import { type InventoryContainerRow } from '../inventory';
import { type UnavailableReason } from '../shared';
import { roundMonthlySavings } from './core/helpers';
import { type CostSourceStatus, type DerivedAdvisory } from './core/types';
import { getBackupCostEstimate } from './fetchers/backupCost';
import {
    classifyCostFailure,
    CostEvidenceError,
    getThroughputRate,
    MULTI_WRITE_METER,
    STANDARD_METER,
    throughputMeter,
    type CostContext,
} from './fetchers/costManagement';

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

function billedUnitsPerHour(advisory: DerivedAdvisory, ru: number, context: CostContext): number | undefined {
    const meter = throughputMeter(context);
    if (!meter) {
        return undefined;
    }
    // DX-008 reports capacity already summed across the copies that could be removed.
    if (advisory.rule === 'MultiRegionWriteAntipattern') {
        return meter === MULTI_WRITE_METER ? ru / 100 : undefined;
    }
    const mode =
        advisory.rule === 'OverProvisioning'
            ? 'manual'
            : advisory.rule === 'AutoscaleMaxOverProvisioned'
              ? 'autoscale'
              : advisory.evidence?.throughputMode;
    if (mode !== 'manual' && mode !== 'autoscale') {
        return undefined;
    }
    const regions = context.locationNames.length;
    if (meter === MULTI_WRITE_METER) {
        return (ru / 100) * regions;
    }
    if (mode === 'autoscale') {
        return (ru / 100) * regions * 1.5;
    }
    const zones = context.zoneRedundantRegionCount;
    return meter === STANDARD_METER && zones !== undefined && Number.isInteger(zones) && zones >= 0 && zones <= regions
        ? (ru / 100) * (regions + 0.25 * zones)
        : undefined;
}

interface CostEnrichmentParams {
    advisories: DerivedAdvisory[];
    cosmosClient: CosmosDBManagementClient;
    monitorClient: MonitorClient;
    context?: CostContext;
    accountId: string;
    inventoryRows?: readonly InventoryContainerRow[];
    inventoryFailureReason?: UnavailableReason;
    now: number;
}

/** One deadline includes all optional requests and SDK retry waits; cancellation never retries ahead of the server. */
export async function enrichAdvisoryCosts(params: CostEnrichmentParams): Promise<CostSourceStatus | undefined> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 20_000);
    try {
        const abortSignal = params.context?.abortSignal
            ? AbortSignal.any([params.context.abortSignal, deadline.signal])
            : deadline.signal;
        return await collectAdvisoryCosts({
            ...params,
            context: params.context && { ...params.context, abortSignal },
        });
    } finally {
        deadline.abort();
        clearTimeout(timer);
    }
}

/** Enrichment follows supersession. Independent read failures retain every qualitative/capacity finding. */
async function collectAdvisoryCosts(params: CostEnrichmentParams): Promise<CostSourceStatus | undefined> {
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
            const priced = capacity.flatMap(({ advisory, ru }) => {
                const units = billedUnitsPerHour(advisory, ru, context);
                return units === undefined ? [] : [{ advisory, ru, units }];
            });
            const throughputFailures = new Set<CostSourceStatus['failures'][number]['kind']>();
            if (priced.length !== capacity.length) {
                throughputFailures.add('noData');
            }
            try {
                if (priced.length > 0) {
                    const rate = await getThroughputRate(cosmosClient, context, accountId, now);
                    for (const { advisory, ru, units } of priced) {
                        const amount = units * (rate.cost / rate.usage100RuHours) * 730;
                        if (!Number.isFinite(amount)) {
                            throughputFailures.add('invalidData');
                            continue;
                        }
                        const monthlyAmount = roundMonthlySavings(amount);
                        if (monthlyAmount > 0) {
                            advisory.costEstimate = {
                                basis: 'customerAmortizedBill',
                                monthlyAmount,
                                currency: rate.currency,
                                recoverableRu: ru,
                                billedUnitsPerHour: units,
                                rate,
                            };
                        }
                    }
                }
            } catch (error) {
                throughputFailures.add(classifyCostFailure(error));
            }
            for (const kind of throughputFailures) {
                failures.push({ operation: 'throughput', kind });
            }
        }
    }
    if (backup) {
        if (!context) {
            failures.push({ operation: 'backup', kind: 'notConfigured' });
        } else {
            try {
                if (params.inventoryFailureReason === 'rbac') {
                    throw new CostEvidenceError('accessDenied');
                }
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
