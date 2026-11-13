/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import {
    createDefaultHttpClient,
    createHttpHeaders,
    createPipelineRequest,
    RestError,
} from '@azure/core-rest-pipeline';
import { z } from 'zod';
import { DAY } from '../../shared';
import { type CostFailureKind, type ThroughputRate } from '../core/types';

export interface CostContext {
    subscriptionId: string;
    resourceManagerEndpoint: string;
    /** Complete configured ARM location list, not a caller-selected subset of regions. */
    locationNames: readonly string[];
}

export class CostEvidenceError extends Error {
    constructor(public readonly kind: CostFailureKind) {
        super(`Cost evidence unavailable: ${kind}.`);
    }
}

export function classifyCostFailure(error: unknown): CostFailureKind {
    if (error instanceof CostEvidenceError) {
        return error.kind;
    }
    if (error && typeof error === 'object') {
        const status = 'statusCode' in error ? error.statusCode : undefined;
        if (status === 401) {
            return 'authentication';
        }
        if (status === 403) {
            return 'accessDenied';
        }
        if (status === 429) {
            return 'rateLimited';
        }
        if (typeof status === 'number' && status >= 500) {
            return 'serviceError';
        }
        const code = 'code' in error ? error.code : undefined;
        const name = 'name' in error ? error.name : undefined;
        if (code === 'ETIMEDOUT' || name === 'AbortError' || name === 'TimeoutError') {
            return 'timeout';
        }
    }
    return 'queryError';
}

/** Fixed ARM endpoint and existing authenticated pipeline preserve cloud, identity and bounded SDK retry policy. */
export async function readCostArmJson(
    client: CosmosDBManagementClient,
    context: CostContext,
    path: string,
    body?: unknown,
): Promise<unknown> {
    const response = await client.pipeline.sendRequest(
        createDefaultHttpClient(),
        createPipelineRequest({
            url: `${context.resourceManagerEndpoint.replace(/\/+$/, '')}${path}`,
            method: body === undefined ? 'GET' : 'POST',
            headers: createHttpHeaders({ 'Content-Type': 'application/json' }),
            body: body === undefined ? undefined : JSON.stringify(body),
            timeout: 20_000,
        }),
    );
    if (response.status < 200 || response.status >= 300) {
        throw new RestError('Optional cost evidence request failed.', { statusCode: response.status });
    }
    try {
        return JSON.parse(response.bodyAsText ?? 'null') as unknown;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new CostEvidenceError('invalidData');
        }
        throw error;
    }
}

const responseSchema = z.object({
    error: z.undefined().optional(),
    properties: z.object({
        nextLink: z.string().nullable().optional(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        rows: z.array(z.array(z.unknown())),
    }),
});

/** Account-attributed amortized provisioned-throughput rate, never a subscription or retail-price substitute. */
export async function getThroughputRate(
    client: CosmosDBManagementClient,
    context: CostContext,
    accountId: string,
    now: number,
): Promise<ThroughputRate> {
    const end = new Date(now);
    end.setUTCHours(0, 0, 0, 0);
    const observationEnd = end.toISOString();
    const observationStart = new Date(end.getTime() - 30 * DAY).toISOString();
    const payload = await readCostArmJson(
        client,
        context,
        `/subscriptions/${encodeURIComponent(context.subscriptionId)}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`,
        {
            type: 'AmortizedCost',
            timeframe: 'Custom',
            timePeriod: { from: observationStart, to: observationEnd },
            dataset: {
                granularity: 'None',
                aggregation: {
                    totalCost: { name: 'Cost', function: 'Sum' },
                    usage: { name: 'UsageQuantity', function: 'Sum' },
                },
                grouping: [
                    { type: 'Dimension', name: 'MeterCategory' },
                    { type: 'Dimension', name: 'Meter' },
                ],
                filter: { dimensions: { name: 'ResourceId', operator: 'In', values: [accountId] } },
            },
        },
    );
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.properties.nextLink) {
        throw new CostEvidenceError('invalidData');
    }
    const { columns, rows } = parsed.data.properties;
    const indexes = new Map(columns.map((column, index) => [column.name, index]));
    if (indexes.size !== columns.length) {
        throw new CostEvidenceError('invalidData');
    }
    if (rows.length === 0) {
        throw new CostEvidenceError('noData');
    }
    const indexOf = (name: string, type: string): number => {
        const index = indexes.get(name);
        if (index === undefined || columns[index].type !== type) {
            throw new CostEvidenceError('invalidData');
        }
        return index;
    };
    const costIndex = indexOf('Cost', 'Number');
    const usageIndex = indexOf('UsageQuantity', 'Number');
    const categoryIndex = indexOf('MeterCategory', 'String');
    const meterIndex = indexOf('Meter', 'String');
    const currencyIndex = indexOf('Currency', 'String');
    let cost = 0;
    let usage = 0;
    let currency: string | undefined;
    const meters = new Set<string>();
    for (const row of rows) {
        const category = row[categoryIndex];
        const meter = row[meterIndex];
        if (row.length !== columns.length || typeof category !== 'string' || typeof meter !== 'string') {
            throw new CostEvidenceError('invalidData');
        }
        if (category !== 'Azure Cosmos DB' || !meter.trim().endsWith('RU/s')) {
            continue;
        }
        const rowCost = row[costIndex];
        const rowUsage = row[usageIndex];
        const rowCurrency = row[currencyIndex];
        if (
            typeof rowCost !== 'number' ||
            !Number.isFinite(rowCost) ||
            rowCost < 0 ||
            typeof rowUsage !== 'number' ||
            !Number.isFinite(rowUsage) ||
            rowUsage < 0 ||
            typeof rowCurrency !== 'string' ||
            !/^[A-Z]{3}$/.test(rowCurrency) ||
            (currency !== undefined && currency !== rowCurrency)
        ) {
            throw new CostEvidenceError('invalidData');
        }
        cost += rowCost;
        usage += rowUsage;
        currency = rowCurrency;
        meters.add(meter.trim());
    }
    if (!Number.isFinite(cost) || !Number.isFinite(usage)) {
        throw new CostEvidenceError('invalidData');
    }
    if (cost <= 0 || usage <= 0 || currency === undefined) {
        throw new CostEvidenceError('noData');
    }
    const perRuMonth = (cost / usage / 100) * 730;
    if (!Number.isFinite(perRuMonth) || perRuMonth <= 0) {
        throw new CostEvidenceError('invalidData');
    }
    return {
        source: 'customerAmortizedBill',
        scope: 'account',
        currency,
        cost,
        usage100RuHours: usage,
        meters: [...meters].sort(),
        observationStart,
        observationEnd,
        perRuMonth,
    };
}
