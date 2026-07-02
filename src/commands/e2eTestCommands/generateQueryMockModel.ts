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
 * Query flow: the route ids and the canned LLM responses they map to.
 *
 * Every route drives the *real* `generateQueryWithLLM` service — nothing is
 * bypassed in the tRPC router. In particular the `'confirm'` route emits a real
 * schema-sampling tool call so the genuine agentic loop runs (and shows the
 * Allow/Not now dialog), and `'latency'` stalls until the request is cancelled so
 * the Cancel affordance can be exercised.
 */

import type * as vscode from 'vscode';
import { SAMPLE_DATA_TOOL_NAME } from '../../chat/sampleDataTool';
import { type E2eMockResponseResolver, setE2eMockResponseResolver, setE2eMockRoute } from '../../utils/aiUtils';
import { type MockResponse, type MockResponsePart } from '../../utils/languageModelMockUtils';

/**
 * Route ids for the Generate Query e2e mock model. Selected via
 * {@link setE2eGenerateQueryRoute} so the *real* `generateQueryWithLLM` flow runs
 * down the matching branch instead of being bypassed:
 *  - `success` — streams a query string.
 *  - `error`   — streams an `ERROR:` refusal (→ `QueryGenerationRefusedError`).
 *  - `confirm` — streams a schema-sampling tool call, driving the real agentic
 *                loop (Allow/Not now dialog), then the query on the next round.
 *  - `latency` — stalls until the request's cancellation token fires, so the
 *                Cancel button can abort an in-flight generation.
 */
export type E2eGenerateQueryRoute = 'success' | 'error' | 'confirm' | 'latency';

/** Query the mock LLM streams back on the `'success'` / `'confirm'` / `'latency'` routes. */
const MOCK_GENERATED_QUERY = 'SELECT * FROM c WHERE c.price < 20';

/**
 * Refusal text streamed on the `'error'` route. The `ERROR:` prefix is what
 * `generateQueryWithLLM` looks for to raise a `QueryGenerationRefusedError`,
 * which the query editor surfaces as an error bar.
 */
const MOCK_REFUSAL_MESSAGE = 'I cannot generate a query for that request. Please provide a valid prompt.';

/** How long the `'latency'` route stalls before answering, so a test can Cancel mid-flight. */
const LATENCY_MS = 3_000;

/** Cancellable sleep — resolves early when the request's cancellation token fires. */
function delay(ms: number, token?: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        token?.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/** The schema-sampling tool call streamed as the `'confirm'` route's first response. */
const SCHEMA_SAMPLING_TOOL_CALL: MockResponsePart = { type: 'toolCall', name: SAMPLE_DATA_TOOL_NAME, input: {} };

/**
 * One scripted response for a single `sendRequest`: either a static payload or a
 * function (used when the payload is dynamic — e.g. awaiting a cancellable delay).
 */
type MockStep = MockResponse | E2eMockResponseResolver;

/**
 * Each route is simply an ordered list of responses. The mock plays them back
 * one per `sendRequest`, clamping at the last, so multi-round flows fall out
 * without the mock knowing anything about their intent: `'confirm'` is just a
 * two-response route (a schema-sampling tool call, then the query) — the mock
 * neither knows nor cares that those two rounds happen to drive the Allow/Not now
 * dialog.
 */
const ROUTE_RESPONSES: Record<E2eGenerateQueryRoute, readonly MockStep[]> = {
    success: [MOCK_GENERATED_QUERY],
    error: [`ERROR: ${MOCK_REFUSAL_MESSAGE}`],
    confirm: [[SCHEMA_SAMPLING_TOOL_CALL], MOCK_GENERATED_QUERY],
    latency: [
        async ({ token }) => {
            // Stall so the spec can click Cancel; cancelling the request unblocks
            // us early and the router then discards the (now stale) result.
            await delay(LATENCY_MS, token);
            return MOCK_GENERATED_QUERY;
        },
    ],
};

/** Index into the active route's response list; advanced per request, reset on route change. */
let responseIndex = 0;

/**
 * Streams the next response for the active sticky route (see
 * {@link setE2eMockRoute}), advancing through {@link ROUTE_RESPONSES} and clamping
 * at the last entry. The real `generateQueryWithLLM` service then processes it
 * end-to-end.
 */
const resolveGenerateQueryResponse: E2eMockResponseResolver = (args) => {
    const responses = (args.route && ROUTE_RESPONSES[args.route as E2eGenerateQueryRoute]) || [''];
    const step = responses[Math.min(responseIndex, responses.length - 1)];
    responseIndex++;
    return typeof step === 'function' ? step(args) : step;
};

/**
 * Points the shared e2e mock model at the Generate Query resolver and selects
 * the route it plays back on subsequent `sendRequest`s. Passing `undefined`
 * resets both the resolver and the route. E2e-only.
 */
export function setE2eGenerateQueryRoute(route: E2eGenerateQueryRoute | undefined): void {
    // Restart the response sequence for the new generation.
    responseIndex = 0;
    setE2eMockResponseResolver(route ? resolveGenerateQueryResponse : undefined);
    setE2eMockRoute(route);
}
