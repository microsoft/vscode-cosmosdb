/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { describe, expect, it, vi } from 'vitest';
import { classifyCostFailure, CostEvidenceError, getThroughputRate, type CostContext } from './costManagement';

const now = Date.parse('2026-11-11T15:40:00Z');
const accountId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account';
const context: CostContext = {
    subscriptionId: 'sub',
    resourceManagerEndpoint: 'https://management.azure.com/',
    locationNames: ['East US'],
};
const columns = [
    { name: 'UsageQuantity', type: 'Number' },
    { name: 'Meter', type: 'String' },
    { name: 'Currency', type: 'String' },
    { name: 'Cost', type: 'Number' },
    { name: 'MeterCategory', type: 'String' },
];
const row = (
    cost: unknown = 8,
    usage: unknown = 1000,
    currency = 'EUR',
    meter = '100 RU/s',
    category = 'Azure Cosmos DB',
) => [usage, meter, currency, cost, category];

function setup(properties: unknown = { columns, rows: [row()] }, status = 200) {
    const client = new CosmosDBManagementClient({ getToken: async () => null }, 'sub');
    const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_http, request) => ({
        request,
        status,
        headers: createHttpHeaders(),
        bodyAsText: JSON.stringify({ properties }),
    }));
    return { client, send };
}

describe('account-attributed throughput billing', () => {
    it('uses the existing cloud pipeline, exact account filter and billed usage rather than configured RU', async () => {
        const { client, send } = setup({
            columns,
            rows: [
                row(),
                row(16, 1000, 'EUR', '100 Multi-master RU/s'),
                row(900, 1, 'USD', 'Standard 100 RU/s', 'Microsoft Defender for Cloud'),
                row(200, 1, 'USD', 'Data Stored'),
                row(300, 1, 'USD', '1M RUs'),
            ],
        });
        const cloud = { ...context, resourceManagerEndpoint: 'https://management.usgovcloudapi.net/' };
        const rate = await getThroughputRate(client, cloud, accountId, now);
        expect(send).toHaveBeenCalledOnce();
        const request = send.mock.calls[0][1];
        expect(request.url).toBe(
            'https://management.usgovcloudapi.net/subscriptions/sub/providers/Microsoft.CostManagement/query?api-version=2023-11-01',
        );
        expect(request.method).toBe('POST');
        expect(request.timeout).toBe(20_000);
        expect(JSON.parse(String(request.body))).toEqual({
            type: 'AmortizedCost',
            timeframe: 'Custom',
            timePeriod: { from: '2026-10-12T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' },
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
        });
        expect(rate).toMatchObject({
            scope: 'account',
            source: 'customerAmortizedBill',
            currency: 'EUR',
            cost: 24,
            usage100RuHours: 2000,
            meters: ['100 Multi-master RU/s', '100 RU/s'],
        });
        expect(rate.perRuMonth).toBeCloseTo((24 / 2000 / 100) * 730, 12);
    });

    it.each([{ rows: [row(0, 1000)] }, { rows: [row(8, 0)] }, { rows: [] }, { rows: [row(1, 1, 'USD', '1M RUs')] }])(
        'does not fabricate a rate or broaden scope without positive throughput cost/usage: %j',
        async ({ rows }) => {
            const { client, send } = setup({ columns, rows });
            await expect(getThroughputRate(client, context, accountId, now)).rejects.toMatchObject({ kind: 'noData' });
            expect(send).toHaveBeenCalledOnce();
        },
    );

    it.each([
        { columns: [...columns, columns[0]], rows: [] },
        { columns: columns.slice(1), rows: [row()] },
        { columns: columns.map((col) => ({ ...col, type: 'String' })), rows: [row()] },
        { columns, rows: [[...row(), 'extra']] },
        { columns, rows: [row(-1)] },
        { columns, rows: [row(8, -1)] },
        { columns, rows: [row(8, 1000, '')] },
        { columns, rows: [row(8, 1000, 'EUR'), row(8, 1000, 'USD')] },
        { columns, rows: [row(8, 1000), [1000, null, 'EUR', 8, 'Azure Cosmos DB']] },
        { columns, rows: [row('8')] },
        { columns, rows: [row(8, '1000')] },
        { columns, rows: [row()], nextLink: 'https://management.azure.com/next' },
        { columns, rows: [row(Number.MAX_VALUE), row(Number.MAX_VALUE)] },
        { columns, rows: [row(1, Number.MIN_VALUE)] },
    ])('rejects invalid or incomplete billing evidence: %j', async (properties) => {
        const { client } = setup(properties);
        await expect(getThroughputRate(client, context, accountId, now)).rejects.toMatchObject({
            kind: 'invalidData',
        });
    });

    it('rejects non-finite numeric cells without silently defaulting them', async () => {
        const { client, send } = setup();
        send.mockImplementation(async (_http, request) => ({
            request,
            status: 200,
            headers: createHttpHeaders(),
            bodyAsText:
                '{"properties":{"columns":' +
                JSON.stringify(columns) +
                ',"rows":[[1000,"100 RU/s","EUR",1e999,"Azure Cosmos DB"]]}}',
        }));
        await expect(getThroughputRate(client, context, accountId, now)).rejects.toMatchObject({ kind: 'invalidData' });
    });

    it.each([
        [401, 'authentication'],
        [403, 'accessDenied'],
        [429, 'rateLimited'],
        [503, 'serviceError'],
        [400, 'queryError'],
    ] as const)(
        'classifies HTTP %s without retrying a broader query or forwarding service prose',
        async (status, kind) => {
            const { client, send } = setup({ error: 'private billing response' }, status);
            const error: unknown = await getThroughputRate(client, context, accountId, now).catch(
                (failure: unknown) => failure,
            );
            expect(classifyCostFailure(error)).toBe(kind);
            expect(String(error)).not.toContain('private billing response');
            expect(send).toHaveBeenCalledOnce();
        },
    );

    it.each([
        [Object.assign(new Error('private'), { name: 'AbortError' }), 'timeout'],
        [Object.assign(new Error('private'), { name: 'TimeoutError' }), 'timeout'],
        [Object.assign(new Error('private'), { code: 'ETIMEDOUT' }), 'timeout'],
        [new CostEvidenceError('invalidData'), 'invalidData'],
        [new Error('private'), 'queryError'],
    ] as const)('retains a bounded category for %s', (error, expected) => {
        expect(classifyCostFailure(error)).toBe(expected);
    });
});
