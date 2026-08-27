/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { defaultState, dispatch } from './QueryEditorState';

function makeResult(query: string, countPerPage = 100): SerializedQueryResult {
    return {
        documents: [{ id: query }],
        iteration: 0,
        metadata: { countPerPage },
        indexMetrics: '',
        requestCharge: 1,
        roundTrips: 1,
        hasMoreResults: false,
        query,
    };
}

describe('QueryEditorState', () => {
    describe('updateQueryResult', () => {
        it('applies a result whose executionId matches the current execution', () => {
            const state = { ...defaultState, currentExecutionId: 'exec-B' };
            const result = makeResult('SELECT * FROM b');

            const next = dispatch(state, {
                type: 'updateQueryResult',
                executionId: 'exec-B',
                result,
                currentPage: 1,
            });

            expect(next.currentQueryResult).toBe(result);
        });

        it('ignores a late result from a superseded execution', () => {
            // Execution A started, then execution B started (B is now current). A late result from
            // A must not replace the grid that belongs to B.
            const bResult = makeResult('SELECT * FROM b');
            const state = {
                ...defaultState,
                currentExecutionId: 'exec-B',
                currentQueryResult: bResult,
            };

            const next = dispatch(state, {
                type: 'updateQueryResult',
                executionId: 'exec-A',
                result: makeResult('SELECT * FROM a'),
                currentPage: 3,
            });

            expect(next).toBe(state);
            expect(next.currentQueryResult).toBe(bResult);
        });

        it('applies a result with an empty executionId (error-recovery path)', () => {
            const state = { ...defaultState, currentExecutionId: 'exec-B' };
            const result = makeResult('SELECT * FROM b');

            const next = dispatch(state, {
                type: 'updateQueryResult',
                executionId: '',
                result,
                currentPage: 1,
            });

            expect(next.currentQueryResult).toBe(result);
        });
    });

    describe('updateThroughputBuckets', () => {
        it('clears a selected bucket that is no longer enabled', () => {
            const state = { ...defaultState, selectedThroughputBucket: 2 };

            const result = dispatch(state, {
                type: 'updateThroughputBuckets',
                throughputBuckets: [true, false, true, true, true],
            });

            expect(result.selectedThroughputBucket).toBeUndefined();
        });

        it('preserves a selected bucket that remains enabled', () => {
            const state = { ...defaultState, selectedThroughputBucket: 2 };

            const result = dispatch(state, {
                type: 'updateThroughputBuckets',
                throughputBuckets: [false, true, false, false, false],
            });

            expect(result.selectedThroughputBucket).toBe(2);
        });

        it('clears the selection when throughput buckets become unavailable', () => {
            const state = { ...defaultState, selectedThroughputBucket: 2 };

            const result = dispatch(state, {
                type: 'updateThroughputBuckets',
                throughputBuckets: undefined,
            });

            expect(result.selectedThroughputBucket).toBeUndefined();
        });
    });
});
