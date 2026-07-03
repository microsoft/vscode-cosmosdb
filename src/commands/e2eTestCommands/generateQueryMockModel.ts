/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generate Query (nl2query) specific e2e mock responses.
 *
 * The shared, control-file-driven engine (dispatch, latency, per-request
 * sequencing) lives in `./e2eAiMock`. This module owns only what is specific to
 * the Generate Query flow: the feature id and the route → canned-response
 * catalogue. Tests select a route by writing `{ feature: 'generateQuery', route }`
 * into the control file; latency is a universal `delayMs` knob handled by the
 * engine, so it is not a route here.
 *
 * Every route drives the *real* `generateQueryWithLLM` service — nothing is
 * bypassed in the tRPC router. In particular the `'requestsSchemaSampling'` route
 * emits a real schema-sampling tool call so the genuine agentic loop runs and
 * shows the Allow/Not now dialog.
 */

import { SAMPLE_DATA_TOOL_NAME } from '../../chat/sampleDataTool';
import { type MockResponsePart } from '../../utils/languageModelMockUtils';
import { type MockRouteCatalog, registerAiMockFeature } from './e2eAiMock';

/** Feature id tests name in the control file to route Generate Query LLM calls. */
export const GENERATE_QUERY_MOCK_FEATURE = 'generateQuery';

/** Query the mock LLM streams back on the `'returnsQuery'` / `'requestsSchemaSampling'` routes. */
const MOCK_GENERATED_QUERY = 'SELECT * FROM c WHERE c.price < 20';

/**
 * Refusal text streamed on the `'returnsRefusal'` route. The `ERROR:` prefix is
 * what `generateQueryWithLLM` looks for to raise a `QueryGenerationRefusedError`,
 * which the query editor surfaces as an error bar.
 */
const MOCK_REFUSAL_MESSAGE = 'I cannot generate a query for that request. Please provide a valid prompt.';

/** The schema-sampling tool call streamed as the `'requestsSchemaSampling'` route's first response. */
const SCHEMA_SAMPLING_TOOL_CALL: MockResponsePart = { type: 'toolCall', name: SAMPLE_DATA_TOOL_NAME, input: {} };

/**
 * Route → ordered responses. The engine plays them back one per `sendRequest`,
 * clamping at the last, so multi-round flows fall out without the mock knowing
 * anything about their intent: `'requestsSchemaSampling'` is just a two-response
 * route (a schema-sampling tool call, then the query) — the mock neither knows nor
 * cares that those two rounds happen to drive the Allow/Not now dialog. Add
 * latency to any route via the control file's `delayMs` knob (e.g. to exercise
 * Cancel).
 */
const CATALOG: MockRouteCatalog = {
    returnsQuery: [MOCK_GENERATED_QUERY],
    returnsRefusal: [`ERROR: ${MOCK_REFUSAL_MESSAGE}`],
    requestsSchemaSampling: [[SCHEMA_SAMPLING_TOOL_CALL], MOCK_GENERATED_QUERY],
};

/** Registers the Generate Query response catalogue with the shared engine. E2e-only. */
export function registerGenerateQueryMock(): void {
    registerAiMockFeature(GENERATE_QUERY_MOCK_FEATURE, CATALOG);
}
