/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { getAccountConsumedRuShape, getAutoscaleUtilization } from './advisories/fetchers/metrics';
import {
    readItems,
    readMetrics,
    readRequest,
    reportReadFailure,
    reportUnavailableClient,
    withReadDiagnostics,
} from './readDiagnostics';
import { getRuTrends, getThrottleRate, querySeries } from './ruTrends';
import { mockClient } from './testFixtures';

describe('invocation-local Account Overview read diagnostics', () => {
    it.each([403, '403', 503])('recognizes HTTP errors in numeric code fields (%s)', async (code) => {
        const error = Object.assign(new Error('private-error'), { code });
        const captured = await withReadDiagnostics(async () => {
            await expect(
                readRequest('inventory', async () => {
                    throw error;
                }),
            ).rejects.toBe(error);
        });

        expect(captured.diagnostics).toEqual([
            {
                source: 'inventory',
                kind: code === 503 ? 'transient' : 'accessDenied',
                reason: code === 503 ? 'noData' : 'rbac',
            },
        ]);
    });

    it('isolates required-metric evidence while preserving every failure on the outer RPC', async () => {
        const client = mockClient({});
        vi.spyOn(client.metrics, 'list').mockImplementation(async (_resource, options) => {
            throw Object.assign(new Error('private-error'), {
                statusCode: options?.metricnames === 'NormalizedRUConsumption' ? 503 : 403,
            });
        });
        const outer = await withReadDiagnostics(() =>
            withReadDiagnostics(async () => {
                await expect(
                    readMetrics(client, 'private-account', { metricnames: 'TotalRequests' }),
                ).rejects.toThrow();
                await expect(
                    readMetrics(client, 'private-account', { metricnames: 'NormalizedRUConsumption' }),
                ).rejects.toThrow();
            }, ['NormalizedRUConsumption']),
        );

        expect(outer.result.diagnostics).toEqual([{ source: 'metrics', kind: 'transient', reason: 'noData' }]);
        expect(outer.diagnostics).toEqual([
            { source: 'metrics', kind: 'accessDenied', reason: 'rbac' },
            { source: 'metrics', kind: 'transient', reason: 'noData' },
        ]);
        expect(JSON.stringify(outer)).not.toContain('private-');
    });

    it.each([
        [
            'series',
            (client: ReturnType<typeof mockClient>) =>
                querySeries(client, 'private-account', 'TotalRequests', 'Total', 'window', 'PT1H', undefined),
        ],
        [
            'throttle',
            (client: ReturnType<typeof mockClient>) =>
                getThrottleRate(client, 'private-account', '7D', 'private-db', 'private-container'),
        ],
        ['account RU', (client: ReturnType<typeof mockClient>) => getAccountConsumedRuShape(client, 'private-account')],
        [
            'autoscale',
            (client: ReturnType<typeof mockClient>) =>
                getAutoscaleUtilization(client, 'private-account', 'private-db', 'private-container', 1000),
        ],
    ] as const)('deduplicates propagated inline errors from %s', async (_label, read) => {
        const client = mockClient({});
        vi.spyOn(client.metrics, 'list').mockResolvedValue({
            cost: 0,
            timespan: 'window',
            value: [
                {
                    id: 'private-id',
                    type: 'private-type',
                    name: { value: 'TotalRequests' },
                    unit: 'Count',
                    timeseries: [],
                    errorCode: 'Forbidden',
                    errorMessage: 'private-account is denied',
                },
            ],
        });
        const captured = await withReadDiagnostics(async () => {
            await expect(
                readRequest('metrics', async () => {
                    await read(client);
                }),
            ).rejects.toMatchObject({ code: 'Forbidden' });
        });

        expect(captured.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        expect(JSON.stringify(captured)).not.toContain('private-');
    });

    it('keeps an inline RU failure classified after the reader catches it', async () => {
        const client = mockClient({});
        vi.spyOn(client.metrics, 'list').mockResolvedValue({
            cost: 0,
            timespan: 'window',
            value: [
                {
                    id: 'private-id',
                    type: 'private-type',
                    name: { value: 'NormalizedRUConsumption' },
                    unit: 'Percent',
                    timeseries: [],
                    errorCode: 'Forbidden',
                    errorMessage: 'private-account is denied',
                },
            ],
        });
        const captured = await withReadDiagnostics(() =>
            getRuTrends(client, 'private-account', '7D', 'private-db', 'private-container'),
        );

        expect(captured.result).toMatchObject({ available: false, reason: 'rbac' });
        expect(captured.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
    });

    it('preserves successful results and does not fabricate failures for empty reads', async () => {
        const result = { available: false, reason: 'noData' };
        const captured = await withReadDiagnostics(async () => result);

        expect(captured.result).toBe(result);
        expect(captured.diagnostics).toEqual([]);
    });

    it('returns a fail-fast fallback without waiting for a stalled sibling read', async () => {
        const sibling = Promise.withResolvers<void>();
        const error = Object.assign(new Error('private-service-error'), { statusCode: 403 });
        const fallback = { available: false };
        let completed = false;
        const captured = withReadDiagnostics(async () => {
            try {
                await Promise.all([
                    readRequest('metrics', async () => {
                        throw error;
                    }),
                    readRequest('metrics', () => sibling.promise),
                ]);
                return { available: true };
            } catch {
                return fallback;
            }
        });

        void captured.then(() => {
            completed = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const completedBeforeSibling = completed;

        sibling.resolve();
        const result = await captured;

        expect(completedBeforeSibling).toBe(true);
        expect(result.result).toBe(fallback);
        expect(result.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
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

    it('does not mutate completed diagnostics when a sibling fails later', async () => {
        const sibling = Promise.withResolvers<void>();
        const error = Object.assign(new Error('private-service-error'), { statusCode: 403 });
        const captured = await withReadDiagnostics(async () => {
            try {
                await Promise.all([
                    readRequest('metrics', async () => {
                        throw error;
                    }),
                    readRequest('logs', async () => {
                        await sibling.promise;
                        throw Object.assign(new Error('private-late-error'), { statusCode: 503 });
                    }),
                ]);
                return { available: true };
            } catch {
                return { available: false };
            }
        });

        expect(captured.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
        sibling.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(captured.diagnostics).toEqual([{ source: 'metrics', kind: 'accessDenied', reason: 'rbac' }]);
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
