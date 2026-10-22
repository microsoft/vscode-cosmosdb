/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MetricUnavailableReason } from './contracts';

export type StorageObservation =
    | { status: 'available'; bytes: number; timestamp: number }
    | { status: 'unavailable'; reason: MetricUnavailableReason };

/** A snapshot of the independently observed storage components, never an implied zero for missing data. */
export interface StorageMeasurement {
    data: StorageObservation;
    index: StorageObservation;
}

export type StorageSummary =
    | { status: 'complete' | 'partial'; bytes: number }
    | { status: 'unavailable'; bytes?: undefined };

export function summarizeStorage(storage: StorageMeasurement): StorageSummary {
    const { data, index } = storage;
    if (data.status === 'available' && index.status === 'available') {
        return { status: 'complete', bytes: data.bytes + index.bytes };
    }
    if (data.status === 'available' || index.status === 'available') {
        return {
            status: 'partial',
            bytes: (data.status === 'available' ? data.bytes : 0) + (index.status === 'available' ? index.bytes : 0),
        };
    }
    return { status: 'unavailable' };
}

export function unavailableStorage(reason: MetricUnavailableReason): StorageMeasurement {
    return { data: { status: 'unavailable', reason }, index: { status: 'unavailable', reason } };
}

/** With a timestamp, read only that bucket; without one, read the latest observation without filling gaps. */
export function storageObservation(
    series: ReadonlyMap<number, number>,
    reason: MetricUnavailableReason = 'noData',
    timestamp?: number,
): StorageObservation {
    const at = timestamp ?? (series.size > 0 ? Math.max(...series.keys()) : undefined);
    const bytes = at === undefined ? undefined : series.get(at);
    return at !== undefined && bytes !== undefined
        ? { status: 'available', bytes, timestamp: at }
        : { status: 'unavailable', reason };
}
