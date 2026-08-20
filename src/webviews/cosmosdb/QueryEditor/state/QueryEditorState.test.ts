/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defaultState, dispatch } from './QueryEditorState';

describe('QueryEditorState', () => {
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
