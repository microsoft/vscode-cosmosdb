/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MonitorClient } from '@azure/arm-monitor';

// Shared test fixtures for the Account Overview service suites. These helpers build the minimal
// Azure Monitor payload shapes the pure service functions consume, plus mock clients that dispatch
// on the requested metric name. Kept in a non-`.test.ts` module so vitest does not treat it as a
// suite.

export const GB = 1024 * 1024 * 1024;

export type Meta = { name?: { value?: string }; value?: string };
export type Point = { timeStamp: string; maximum?: number; average?: number; total?: number };
export type Series = { metadatavalues?: Meta[]; data?: Point[] };

/** Builds the database/collection (and optional status-code) dimension metadata for a series. */
export function dims(database: string, collection: string, statusCode?: string): Meta[] {
    const meta: Meta[] = [
        { name: { value: 'DatabaseName' }, value: database },
        { name: { value: 'CollectionName' }, value: collection },
    ];
    if (statusCode !== undefined) {
        meta.push({ name: { value: 'StatusCode' }, value: statusCode });
    }
    return meta;
}

/** Builds the database/collection plus a partition dimension (e.g. PartitionKeyRangeId) metadata. */
export function pdims(database: string, collection: string, dimension: string, partitionId: string): Meta[] {
    return [
        { name: { value: 'DatabaseName' }, value: database },
        { name: { value: 'CollectionName' }, value: collection },
        { name: { value: dimension }, value: partitionId },
    ];
}

export function iso(ms: number): string {
    return new Date(ms).toISOString();
}

/** Builds a MonitorClient whose `metrics.list` dispatches on the requested metric name. */
export function mockClient(responses: Record<string, { value: { timeseries: Series[] }[] }>): MonitorClient {
    return {
        metrics: {
            list: (_resourceUri: string, options: { metricnames?: string }) => {
                return Promise.resolve(responses[options.metricnames ?? ''] ?? { value: [] });
            },
        },
    } as unknown as MonitorClient;
}

/** A MonitorClient whose `metrics.list` rejects with the given error. */
export function throwingClient(error: unknown): MonitorClient {
    return {
        metrics: {
            list: () => Promise.reject(error instanceof Error ? error : Object.assign(new Error('test'), error)),
        },
    } as unknown as MonitorClient;
}
