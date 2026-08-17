/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defaultState, dispatch } from './DocumentState';

describe('DocumentState cleanup', () => {
    it('preserves pending cleanup when a document is loaded', () => {
        const state = {
            ...defaultState,
            cleanupRequiredMessage: 'Cleanup required',
        };

        const result = dispatch(state, {
            type: 'setDocument',
            documentContent: '{"id":"source"}',
            partitionKey: { paths: ['/pk'] },
        });

        expect(result.cleanupRequiredMessage).toBe('Cleanup required');
    });

    it('clears pending cleanup and establishes the destination baseline when cleanup completes', () => {
        const state = {
            ...defaultState,
            documentContent: '{"id":"source"}',
            currentDocumentContent: '{"id":"destination","edited":true}',
            isDirty: true,
            cleanupRequiredMessage: 'Cleanup required',
        };

        const result = dispatch(state, {
            type: 'completeCleanup',
            documentContent: '{"id":"destination"}',
            partitionKey: { paths: ['/pk'] },
        });

        expect(result.documentContent).toBe('{"id":"destination"}');
        expect(result.currentDocumentContent).toBe('{"id":"destination"}');
        expect(result.isDirty).toBe(false);
        expect(result.cleanupRequiredMessage).toBeUndefined();
    });
});
