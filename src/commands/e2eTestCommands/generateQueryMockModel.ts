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
 *
 * Every route drives the *real* `generateQueryWithLLM` service — nothing is
 * bypassed in the tRPC router. In particular the `'confirm'` route emits a real
 * schema-sampling tool call so the genuine agentic loop runs (and shows the
 * Allow/Not now dialog), and `'latency'` stalls until the request is cancelled so
 * the Cancel affordance can be exercised.
 */

import * as vscode from 'vscode';
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

/**
 * True once the agentic loop has fed a tool result back into the conversation
 * (Allow → sampled schema, or Not now → "declined" note). The `'confirm'` route
 * uses this to emit the schema-sampling tool call on the first round and the
 * final query on the second.
 */
function messagesContainToolResult(messages: readonly vscode.LanguageModelChatMessage[]): boolean {
    return messages.some((message) => {
        const content = (message as { content?: unknown }).content;
        return Array.isArray(content) && content.some((part) => part instanceof vscode.LanguageModelToolResultPart);
    });
}

/** The schema-sampling tool call emitted by the `'confirm'` route's first round. */
const SCHEMA_SAMPLING_TOOL_CALL: MockResponsePart = { type: 'toolCall', name: SAMPLE_DATA_TOOL_NAME, input: {} };

/**
 * Maps the active sticky route (see {@link setE2eMockRoute}) to what the mock
 * streams back. The real `generateQueryWithLLM` service then processes it
 * end-to-end. Async so the `'latency'` route can await a cancellable delay.
 */
const resolveGenerateQueryResponse: E2eMockResponseResolver = async ({
    route,
    messages,
    token,
}): Promise<MockResponse> => {
    if (route === 'error') {
        return `ERROR: ${MOCK_REFUSAL_MESSAGE}`;
    }
    if (route === 'latency') {
        // Stall so the spec can click Cancel; cancelling the request unblocks us
        // early and the router then discards the (now stale) result.
        await delay(LATENCY_MS, token);
        return MOCK_GENERATED_QUERY;
    }
    if (route === 'confirm') {
        // Round 1: request schema sampling (drives onConfirm → Allow/Not now dialog).
        // Round 2 (tool result fed back): return the query.
        return messagesContainToolResult(messages) ? MOCK_GENERATED_QUERY : [SCHEMA_SAMPLING_TOOL_CALL];
    }
    // 'success'
    return MOCK_GENERATED_QUERY;
};

/**
 * Points the shared e2e mock model at the Generate Query resolver and selects
 * the branch it follows on its next `sendRequest`. Passing `undefined` resets
 * both the resolver and the route. E2e-only.
 */
export function setE2eGenerateQueryRoute(route: E2eGenerateQueryRoute | undefined): void {
    setE2eMockResponseResolver(route ? resolveGenerateQueryResponse : undefined);
    setE2eMockRoute(route);
}
