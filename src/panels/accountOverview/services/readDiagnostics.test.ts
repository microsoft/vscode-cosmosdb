/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import {
    readItems,
    readMetrics,
    readRequest,
    reportReadFailure,
    reportUnavailableClient,
    withReadDiagnostics,
} from './readDiagnostics';
import { mockClient } from './testFixtures';

describe('invocation-local Account Overview read diagnostics', () => {
    it('preserves successful results and does not fabricate failures for empty reads', async () => {
        const result = { available: false, reason: 'noData' };
        const captured = await withReadDiagnostics(async () => result);

        expect(captured.result).toBe(result);
        expect(captured.diagnostics).toEqual([]);
    });

    it('records only bounded, deduplicated categories while preserving reader errors', async () => {
        const error = Object.assign(new Error('Access to private-account/private-db was denied.'), { statusCode: 403 });
        const captured = await withReadDiagnostics(async () => {
            await expect(
                readRequest('inventory', async () => {
                    throw error;
                }),
            ).rejects.toBe(error);
            reportReadFailure('inventory', error);
            reportUnavailableClient('logs');
            reportUnavailableClient('logs');
            return { available: false };
        });

        expect(captured.diagnostics).toEqual([
            { source: 'inventory', kind: 'accessDenied', reason: 'rbac' },
            { source: 'logs', kind: 'clientUnavailable', reason: 'noData' },
        ]);
        expect(JSON.stringify(captured)).not.toContain('private-');
    });

    it('keeps concurrent invocation scopes isolated', async () => {
        const [first, second] = await Promise.all([
            withReadDiagnostics(async () => {
                await Promise.resolve();
                reportUnavailableClient('metrics');
                return 'first';
            }),
            withReadDiagnostics(async () => {
                reportUnavailableClient('logs');
                await Promise.resolve();
                return 'second';
            }),
        ]);

        expect(first.diagnostics.map(({ source }) => source)).toEqual(['metrics']);
        expect(second.diagnostics.map(({ source }) => source)).toEqual(['logs']);
    });

    it('does not retag an already recorded nested failure as another source', async () => {
        const error = Object.assign(new Error('private-service-error'), { statusCode: 503 });
        const captured = await withReadDiagnostics(async () => {
            await expect(
                readRequest('metrics', () =>
                    readRequest('activityLog', async () => {
                        throw error;
                    }),
                ),
            ).rejects.toBe(error);
            return undefined;
        });

        expect(captured.diagnostics).toEqual([{ source: 'activityLog', kind: 'transient', reason: 'noData' }]);
    });

    it('records inline metric errors without changing the existing SDK response or throwing', async () => {
        const client = mockClient({});
        const response = {
            cost: 0,
            timespan: 'test-window',
            value: [
                {
                    id: 'private-id',
                    type: 'private-type',
                    name: { value: 'TotalRequests' },
                    unit: 'Count',
                    timeseries: [],
                    errorCode: 'Forbidden',
                    errorMessage: 'Access to private-account was denied.',
                },
            ],
        } satisfies Awaited<ReturnType<typeof client.metrics.list>>;
        vi.spyOn(client.metrics, 'list').mockResolvedValueOnce(response);
        const captured = await withReadDiagnostics(() => readMetrics(client, 'private-account'));

        expect(captured.result).toBe(response);
        expect(captured.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        expect(JSON.stringify(captured.diagnostics)).not.toContain('private-');
    });

    it('preserves streamed items and records a later iterator failure', async () => {
        const error = Object.assign(new Error('private-activity-log'), { statusCode: 403 });
        const values: number[] = [];
        const captured = await withReadDiagnostics(async () => {
            await expect(
                (async () => {
                    for await (const value of readItems('activityLog', async function* () {
                        yield 1;
                        throw error;
                    })) {
                        values.push(value);
                    }
                })(),
            ).rejects.toBe(error);
        });

        expect(values).toEqual([1]);
        expect(captured.diagnostics).toEqual([{ source: 'activityLog', kind: 'accessDenied', reason: 'rbac' }]);
    });
});
