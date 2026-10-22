/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { storageObservation, summarizeStorage, unavailableStorage } from './storage';

describe('storage measurements', () => {
    it.each([
        [10, 1, 'complete', 11],
        [0, 0, 'complete', 0],
        [0, 1, 'complete', 1],
        [10, undefined, 'partial', 10],
        [undefined, 1, 'partial', 1],
        [undefined, 0, 'partial', 0],
        [undefined, undefined, 'unavailable', undefined],
    ] as const)('summarizes data=%s and indexes=%s without inventing observations', (data, index, status, bytes) => {
        const measurement = {
            data: storageObservation(data === undefined ? new Map() : new Map([[1000, data]])),
            index: storageObservation(index === undefined ? new Map() : new Map([[1000, index]])),
        };
        const summary = summarizeStorage(measurement);
        expect(summary.status).toBe(status);
        expect(summary.bytes).toBe(bytes);
    });

    it('reads the latest observation regardless of insertion order, but never fills an exact bucket', () => {
        const series = new Map([
            [2000, 20],
            [1000, 10],
        ]);
        expect(storageObservation(series)).toEqual({ status: 'available', bytes: 20, timestamp: 2000 });
        expect(storageObservation(series, 'noData', 1500)).toEqual({ status: 'unavailable', reason: 'noData' });
        expect(storageObservation(new Map(), 'rbac')).toEqual({ status: 'unavailable', reason: 'rbac' });
        expect(summarizeStorage(unavailableStorage('error'))).toEqual({ status: 'unavailable' });
    });
});
