/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { defaultState, dispatch, type DispatchAction } from './QueryEditorState';

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

        it('rejects a result without an executionId', () => {
            const state = { ...defaultState, currentExecutionId: 'exec-B' };
            const result = makeResult('SELECT * FROM b');

            const next = dispatch(state, {
                type: 'updateQueryResult',
                executionId: '',
                result,
                currentPage: 1,
            });

            expect(next).toBe(state);
        });
    });

    describe('connection changes', () => {
        const populatedState = {
            ...defaultState,
            isConnected: true,
            dbName: 'db',
            containerName: 'A',
            partitionKey: { paths: ['/pk'] },
            currentExecutionId: 'old-execution',
            currentQueryResult: makeResult('SELECT * FROM c'),
            selectedRows: [0],
            pageNumber: 3,
            isExecuting: true,
            isEditMode: true,
            startExecutionTime: 10,
            endExecutionTime: 20,
            queryValue: 'SELECT * FROM c',
            pageSize: 50,
            tableViewMode: 'JSON' as const,
            connectionList: { db: ['A'] },
        };

        for (const action of [
            { type: 'databaseConnected', dbName: 'db', containerName: 'B', partitionKey: { paths: ['/newPk'] } },
            { type: 'databaseDisconnected' },
        ] satisfies DispatchAction[]) {
            it(`clears results and execution state on ${action.type}, preserving editor preferences`, () => {
                const next = dispatch(populatedState, action);
                expect(next).toMatchObject({
                    currentQueryResult: null,
                    selectedRows: [],
                    currentExecutionId: '',
                    pageNumber: 1,
                    isExecuting: false,
                    isEditMode: false,
                    startExecutionTime: 0,
                    endExecutionTime: 0,
                    connectionList: undefined,
                    queryValue: populatedState.queryValue,
                    pageSize: 50,
                    tableViewMode: 'JSON',
                });
                expect(
                    dispatch(next, {
                        type: 'updateQueryResult',
                        executionId: 'old-execution',
                        result: populatedState.currentQueryResult,
                        currentPage: 3,
                    }),
                ).toBe(next);
                expect(
                    dispatch(next, {
                        type: 'executionStopped',
                        executionId: 'old-execution',
                        endExecutionTime: 30,
                    }),
                ).toBe(next);
            });
        }

        it('preserves existing results on a failed or cancelled transition', () => {
            const pending = dispatch(populatedState, { type: 'connectionChangeStarted' });
            expect(pending.isChangingConnection).toBe(true);
            expect(dispatch(pending, { type: 'connectionChangeFinished' })).toEqual(populatedState);
        });

        it('does not stop a new execution when an old one fails', () => {
            const next = dispatch(populatedState, {
                type: 'executionStarted',
                executionId: 'new',
                startExecutionTime: 30,
            });
            expect(
                dispatch(next, { type: 'executionStopped', executionId: 'old-execution', endExecutionTime: 40 }),
            ).toBe(next);
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
