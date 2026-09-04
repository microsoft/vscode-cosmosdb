/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    isLargeQueryResultJson,
    QUERY_RESULT_JSON_PREVIEW_BYTES,
    QUERY_RESULT_JSON_WARNING_BYTES,
} from './queryResultJsonPolicy';

describe('queryResultJsonPolicy', () => {
    it('warns only when the JSON exceeds the threshold', () => {
        expect(isLargeQueryResultJson(QUERY_RESULT_JSON_WARNING_BYTES - 1)).toBe(false);
        expect(isLargeQueryResultJson(QUERY_RESULT_JSON_WARNING_BYTES)).toBe(false);
        expect(isLargeQueryResultJson(QUERY_RESULT_JSON_WARNING_BYTES + 1)).toBe(true);
    });

    it('keeps the preview budget below the warning threshold', () => {
        expect(QUERY_RESULT_JSON_PREVIEW_BYTES).toBeLessThan(QUERY_RESULT_JSON_WARNING_BYTES);
    });
});
