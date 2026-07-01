/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generate Query (nl2query) specific e2e mock model routing.
 *
 * The shared, feature-agnostic plumbing (a persistent route-aware mock
 * `LanguageModelChat` returned from `getSelectedModel`) lives in
 * `../../utils/aiUtils`. This module owns only what is specific to the Generate
 * Query flow: the route ids and the canned LLM responses they map to. Keeping it
 * separate leaves `aiUtils` reusable by the migration assistant, which drives
 * many more routes of its own.
 */

import { setE2eMockResponseResolver, setE2eMockRoute } from '../../utils/aiUtils';
import { type MockResponse } from '../../utils/languageModelMockUtils';

/**
 * Route ids for the Generate Query e2e mock model. Selected via
 * {@link setE2eGenerateQueryRoute} so the *real* `generateQueryWithLLM` flow runs
 * down either the success or the refusal branch instead of being bypassed.
 */
export type E2eGenerateQueryRoute = 'success' | 'error';

/** Query the mock LLM streams back on the `'success'` route. */
const MOCK_GENERATED_QUERY = 'SELECT * FROM c WHERE c.price < 20';

/**
 * Refusal text streamed on the `'error'` route. The `ERROR:` prefix is what
 * `generateQueryWithLLM` looks for to raise a `QueryGenerationRefusedError`,
 * which the query editor surfaces as an error bar.
 */
const MOCK_REFUSAL_MESSAGE = 'I cannot generate a query for that request. Please provide a valid prompt.';

/**
 * Maps the active route to the text the mock model streams back. The real
 * `generateQueryWithLLM` service then processes it end-to-end:
 *  - `'success'` → a bare query string, returned to the caller as the query.
 *  - `'error'` → an `ERROR:`-prefixed line, parsed into a
 *    `QueryGenerationRefusedError` (the error/refusal UI path).
 *  - anything else → empty (inert default).
 */
function resolveGenerateQueryResponse(route: string | undefined): MockResponse {
    if (route === 'success') {
        return MOCK_GENERATED_QUERY;
    }
    if (route === 'error') {
        return `ERROR: ${MOCK_REFUSAL_MESSAGE}`;
    }
    return '';
}

/**
 * Points the shared e2e mock model at the Generate Query resolver and selects
 * the branch it follows on its next `sendRequest`. Passing `undefined` resets
 * both the resolver and the route. E2e-only.
 */
export function setE2eGenerateQueryRoute(route: E2eGenerateQueryRoute | undefined): void {
    setE2eMockResponseResolver(
        route ? ({ route: activeRoute }) => resolveGenerateQueryResponse(activeRoute) : undefined,
    );
    setE2eMockRoute(route);
}
