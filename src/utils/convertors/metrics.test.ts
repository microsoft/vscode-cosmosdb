/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { indexMetricsToTableItem, queryMetricsToJSON, queryMetricsToTable } from './metrics';
import { makeMetrics, makeResult } from './testFixtures';

describe('queryMetricsToTable', () => {
    it('returns [] when there is no result or no metrics', async () => {
        expect(await queryMetricsToTable(null)).toEqual([]);
        expect(await queryMetricsToTable(makeResult())).toEqual([]);
    });

    it('formats the request charge and includes core metrics', async () => {
        const result = makeResult({ requestCharge: 5, queryMetrics: makeMetrics({ retrievedDocumentSize: 128 }) });
        const stats = await queryMetricsToTable(result);
        const charge = stats.find((s) => s.metric === 'Request Charge');
        expect(charge?.formattedValue).toBe('5 RUs');
        const size = stats.find((s) => s.metric === 'Retrieved document size');
        expect(size?.formattedValue).toBe('128 bytes');
    });

    it('appends Round Trips and Activity id only when present', async () => {
        const without = await queryMetricsToTable(makeResult({ roundTrips: 0, queryMetrics: makeMetrics() }));
        expect(without.some((s) => s.metric === 'Round Trips')).toBe(false);
        expect(without.some((s) => s.metric === 'Activity id')).toBe(false);

        const withExtra = await queryMetricsToTable(
            makeResult({ roundTrips: 3, activityId: 'abc', queryMetrics: makeMetrics() }),
        );
        expect(withExtra.find((s) => s.metric === 'Round Trips')?.value).toBe(3);
        expect(withExtra.find((s) => s.metric === 'Activity id')?.value).toBe('abc');
    });

    it('renders "All" results when countPerPage is -1 and there are no documents', async () => {
        const result = makeResult({ metadata: { countPerPage: -1 }, documents: [], queryMetrics: makeMetrics() });
        const stats = await queryMetricsToTable(result);
        expect(stats.find((s) => s.metric === 'Showing Results')?.value).toBe('All');
    });

    it('renders a 0 - N range when countPerPage is -1 and documents exist', async () => {
        const result = makeResult({
            metadata: { countPerPage: -1 },
            documents: [{ a: 1 }, { b: 2 }],
            queryMetrics: makeMetrics(),
        });
        const stats = await queryMetricsToTable(result);
        expect(stats.find((s) => s.metric === 'Showing Results')?.value).toBe('0 - 2');
    });
});

describe('indexMetricsToTableItem', () => {
    it('trims the raw index metrics string', () => {
        const item = indexMetricsToTableItem(makeResult({ indexMetrics: '  some metrics  ' }));
        expect(item.metric).toBe('Index Metrics');
        expect(item.value).toBe('some metrics');
        expect(item.formattedValue).toBe('some metrics');
    });
});

describe('queryMetricsToJSON', () => {
    it('returns an empty string for null', async () => {
        expect(await queryMetricsToJSON(null)).toBe('');
    });

    it('serializes metrics and appends the index metrics item', async () => {
        const result = makeResult({ indexMetrics: 'idx', queryMetrics: makeMetrics() });
        const json = await queryMetricsToJSON(result);
        const parsed = JSON.parse(json) as Array<{ metric: string; value: unknown }>;
        expect(parsed.some((s) => s.metric === 'Index Metrics' && s.value === 'idx')).toBe(true);
    });
});
