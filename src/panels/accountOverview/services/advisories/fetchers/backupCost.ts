/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type MonitorClient } from '@azure/arm-monitor';
import { RestError } from '@azure/core-rest-pipeline';
import { z } from 'zod';
import { type InventoryContainerRow } from '../../inventory';
import { containerFilter, DAY, escapeODataLiteral, HOUR, MINUTE, parseMonitorTimestamp } from '../../shared';
import { type AdvisoryCostEstimate, type BackupPrice } from '../core/types';
import { CostEvidenceError, readCostArmJson, type CostContext } from './costManagement';

const RETAIL_URL = 'https://prices.azure.com/api/retail/prices';
const PITR_PRODUCT = 'Azure Cosmos DB - PITR';
const PITR_METER = 'Cont 30D Bckp Continuous Backup';
const CURRENCY = 'USD';

const locationsSchema = z.object({
    nextLink: z.string().nullable().optional(),
    value: z.array(
        z.object({
            name: z.string().min(1),
            displayName: z.string().optional(),
            regionalDisplayName: z.string().optional(),
        }),
    ),
});

async function resolveRegions(
    client: CosmosDBManagementClient,
    context: CostContext,
): Promise<{ retailName: string; monitorName: string }[]> {
    const parsed = locationsSchema.safeParse(
        await readCostArmJson(
            client,
            context,
            `/subscriptions/${encodeURIComponent(context.subscriptionId)}/locations?api-version=2022-12-01`,
        ),
    );
    if (!parsed.success || parsed.data.nextLink) {
        throw new CostEvidenceError('invalidData');
    }
    const aliases = new Map<string, Map<string, string | undefined>>();
    for (const location of parsed.data.value) {
        for (const alias of [location.name, location.displayName, location.regionalDisplayName]) {
            if (alias) {
                const key = alias.toLowerCase();
                const names = aliases.get(key) ?? new Map<string, string | undefined>();
                const region = location.name.toLowerCase();
                if (names.has(region) && names.get(region) !== location.displayName) {
                    throw new CostEvidenceError('invalidData');
                }
                names.set(region, location.displayName);
                aliases.set(key, names);
            }
        }
    }
    const regions = context.locationNames.map((name) => {
        const candidates = aliases.get(name.toLowerCase());
        if (candidates?.size !== 1) {
            throw new CostEvidenceError('invalidData');
        }
        const [retailName, monitorName] = [...candidates][0];
        if (!monitorName?.trim()) {
            throw new CostEvidenceError('invalidData');
        }
        return { retailName, monitorName };
    });
    if (regions.length === 0 || new Set(regions.map((region) => region.retailName)).size !== regions.length) {
        throw new CostEvidenceError('invalidData');
    }
    return regions;
}

const retailPageSchema = z.object({
    BillingCurrency: z.literal(CURRENCY),
    Items: z.array(z.record(z.string(), z.unknown())),
    NextPageLink: z.string().nullable().optional(),
});
const priceSchema = z.object({
    armRegionName: z.string(),
    retailPrice: z.number().finite().nonnegative(),
    meterId: z.string().min(1),
    effectiveStartDate: z.string().datetime({ offset: true }),
    effectiveEndDate: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Unauthenticated reads only: no ARM pipeline/tokens and no redirects or pagination outside the fixed endpoint. */
async function getBackupPrices(regions: readonly string[], now: number): Promise<BackupPrice[]> {
    const initial = new URL(RETAIL_URL);
    initial.searchParams.set('$filter', `serviceName eq 'Azure Cosmos DB' and productName eq '${PITR_PRODUCT}'`);
    initial.searchParams.set('currencyCode', CURRENCY);
    let url: string | null | undefined = initial.toString();
    const seen = new Set<string>();
    const prices = new Map<string, BackupPrice>();
    while (url) {
        const target = new URL(url);
        if (
            target.origin !== new URL(RETAIL_URL).origin ||
            target.pathname !== new URL(RETAIL_URL).pathname ||
            target.username ||
            target.password ||
            target.hash ||
            seen.has(url) ||
            seen.size >= 20
        ) {
            throw new CostEvidenceError('invalidData');
        }
        seen.add(url);
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
            throw new RestError('Optional backup price request failed.', { statusCode: response.status });
        }
        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new CostEvidenceError('invalidData');
            }
            throw error;
        }
        const parsed = retailPageSchema.safeParse(payload);
        if (!parsed.success) {
            throw new CostEvidenceError('invalidData');
        }
        for (const item of parsed.data.Items) {
            const region = typeof item.armRegionName === 'string' ? item.armRegionName.toLowerCase() : '';
            if (
                !regions.includes(region) ||
                item.serviceName !== 'Azure Cosmos DB' ||
                item.productName !== PITR_PRODUCT ||
                item.skuName !== 'Backup' ||
                item.meterName !== PITR_METER ||
                item.type !== 'Consumption' ||
                item.unitOfMeasure !== '1 GB' ||
                item.tierMinimumUnits !== 0 ||
                item.isPrimaryMeterRegion !== true
            ) {
                continue;
            }
            const price = priceSchema.safeParse(item);
            if (!price.success || item.currencyCode !== CURRENCY) {
                throw new CostEvidenceError('invalidData');
            }
            const start = Date.parse(price.data.effectiveStartDate);
            const end = price.data.effectiveEndDate ? Date.parse(price.data.effectiveEndDate) : undefined;
            if (end !== undefined && end <= start) {
                throw new CostEvidenceError('invalidData');
            }
            if (start > now || (end !== undefined && now >= end)) {
                continue;
            }
            if (prices.has(region)) {
                throw new CostEvidenceError('invalidData');
            }
            prices.set(region, {
                region,
                perGbMonth: price.data.retailPrice,
                meterId: price.data.meterId,
                effectiveStart: price.data.effectiveStartDate,
                effectiveEnd: price.data.effectiveEndDate ?? undefined,
            });
        }
        url = parsed.data.NextPageLink;
    }
    if (prices.size !== regions.length) {
        throw new CostEvidenceError('noData');
    }
    return regions.map((region) => prices.get(region)!);
}

async function getStorageSnapshot(
    client: MonitorClient,
    accountId: string,
    rows: readonly Pick<InventoryContainerRow, 'databaseId' | 'containerId'>[],
    referenceRegion: string,
    now: number,
): Promise<{ timestamp: number; bytes: number }> {
    const identity = (row: (typeof rows)[number]) => JSON.stringify([row.databaseId, row.containerId]);
    const expected = new Set(rows.map(identity));
    if (!referenceRegion || rows.length === 0) {
        throw new CostEvidenceError('noData');
    }
    if (expected.size !== rows.length || rows.some((row) => !row.databaseId || !row.containerId)) {
        throw new CostEvidenceError('invalidData');
    }
    const snapshots = new Map<number, Map<string, number>>();
    const duplicates = new Set<number>();
    for (let offset = 0; offset < rows.length; offset += 5) {
        await Promise.all(
            rows.slice(offset, offset + 5).map(async (row) => {
                const response = await client.metrics.list(accountId, {
                    metricnames: 'DataUsageV2',
                    aggregation: 'Total',
                    timespan: `${new Date(now - DAY).toISOString()}/${new Date(now).toISOString()}`,
                    interval: 'PT5M',
                    filter: `${containerFilter(row.databaseId, row.containerId)} and Region eq '${escapeODataLiteral(referenceRegion)}'`,
                });
                if (
                    response.value?.length !== 1 ||
                    response.value[0].name?.value !== 'DataUsageV2' ||
                    response.value[0].unit !== 'Bytes' ||
                    (response.value[0].errorCode && response.value[0].errorCode !== 'Success')
                ) {
                    throw new CostEvidenceError('invalidData');
                }
                for (const series of response.value[0].timeseries ?? []) {
                    const metadata = new Map(
                        series.metadatavalues?.map((value) => [value.name?.value?.toLowerCase(), value.value]),
                    );
                    if (
                        metadata.size !== series.metadatavalues?.length ||
                        metadata.size !== 3 ||
                        metadata.get('databasename') !== row.databaseId ||
                        metadata.get('collectionname') !== row.containerId ||
                        metadata.get('region')?.toLowerCase() !== referenceRegion.toLowerCase()
                    ) {
                        throw new CostEvidenceError('invalidData');
                    }
                    for (const point of series.data ?? []) {
                        if (point.total === undefined || point.total === null) {
                            continue;
                        }
                        const timestamp = parseMonitorTimestamp(point.timeStamp);
                        if (timestamp === undefined || !Number.isFinite(point.total) || point.total < 0) {
                            throw new CostEvidenceError('invalidData');
                        }
                        const snapshot = snapshots.get(timestamp) ?? new Map<string, number>();
                        const key = identity(row);
                        if (snapshot.has(key)) {
                            duplicates.add(timestamp);
                        }
                        snapshot.set(key, point.total);
                        snapshots.set(timestamp, snapshot);
                    }
                }
            }),
        );
    }
    const timestamp = [...snapshots.keys()]
        .sort((a, b) => b - a)
        .find((time) => !duplicates.has(time) && snapshots.get(time)?.size === expected.size);
    if (timestamp === undefined || now - timestamp > 6 * HOUR) {
        throw new CostEvidenceError('noData');
    }
    if (timestamp > now + 5 * MINUTE) {
        throw new CostEvidenceError('invalidData');
    }
    const bytes = [...snapshots.get(timestamp)!.values()].reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(bytes)) {
        throw new CostEvidenceError('invalidData');
    }
    return { timestamp, bytes };
}

/** Separate retail-price scenario, not customer-bill savings; restore charges and discounts are not modelled. */
export async function getBackupCostEstimate(
    cosmosClient: CosmosDBManagementClient,
    monitorClient: MonitorClient,
    context: CostContext,
    accountId: string,
    rows: readonly Pick<InventoryContainerRow, 'databaseId' | 'containerId'>[] | undefined,
    now: number,
): Promise<AdvisoryCostEstimate> {
    if (new URL(context.resourceManagerEndpoint).origin !== 'https://management.azure.com') {
        throw new CostEvidenceError('unsupported');
    }
    if (rows === undefined) {
        throw new CostEvidenceError('noData');
    }
    const regions = await resolveRegions(cosmosClient, context);
    const referenceRegion = regions[0].monitorName;
    const snapshot = await getStorageSnapshot(monitorClient, accountId, rows, referenceRegion, now);
    const prices = await getBackupPrices(regions.map((region) => region.retailName), now);
    const monthlyAmount = (snapshot.bytes / 1_000_000_000) * prices.reduce((sum, price) => sum + price.perGbMonth, 0);
    if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) {
        throw new CostEvidenceError('invalidData');
    }
    return {
        basis: 'azureRetailPrice',
        monthlyAmount,
        currency: CURRENCY,
        storageBytes: snapshot.bytes,
        snapshotAt: new Date(snapshot.timestamp).toISOString(),
        referenceRegion,
        logicalContainers: rows.length,
        prices,
    };
}
