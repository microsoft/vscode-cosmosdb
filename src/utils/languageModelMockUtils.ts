/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Symbol-keyed setter installed on every mock model instance. Carrying the
 * route out-of-band (instead of through `LanguageModelChatRequestOptions`)
 * keeps the production VS Code API surface untouched while still letting tests
 * deterministically select a canned response per request.
 */
const MOCK_ROUTE_SETTER = Symbol('cosmosDbMockRouteSetter');

type MockRouteSetter = (route: string | undefined) => void;

/**
 * Sets the active route id on a mock model produced by
 * {@link createMockLanguageModel}. The route is **sticky**: it persists across
 * subsequent `sendRequest` calls until changed (like `vi.fn().mockReturnValue`),
 * so multi-round flows such as an agentic loop can set it once. Pass `undefined`
 * to clear it. No-op on real `LanguageModelChat` instances, so callers can
 * invoke it unconditionally before `sendRequest`.
 */
export function setMockRoute(model: vscode.LanguageModelChat, route: string | undefined): void {
    const setter = (model as unknown as Record<symbol, unknown>)[MOCK_ROUTE_SETTER];
    if (typeof setter === 'function') {
        (setter as MockRouteSetter)(route);
    }
}

/**
 * A single part of a scripted mock response.
 *  - `text` becomes a `vscode.LanguageModelTextPart` in the stream.
 *  - `toolCall` becomes a `vscode.LanguageModelToolCallPart`, which drives the
 *    agentic tool-calling loop (`runAgenticLoop`) so its tool branch can be
 *    exercised in unit tests.
 */
export type MockResponsePart =
    | { type: 'text'; value: string }
    | { type: 'toolCall'; name: string; callId?: string; input?: unknown };

/**
 * What a resolver may return for a single request: a plain string (sugar for a
 * single text part) or an ordered list of parts (text and/or tool calls).
 */
export type MockResponse = string | readonly MockResponsePart[];

export interface CreateMockLanguageModelOptions {
    id: string;
    name: string;
    vendor?: string;
    family?: string;
    version?: string;
    maxInputTokens?: number;
    /**
     * Returns what should be streamed back for a request. Return a string for a
     * plain text answer, or an array of {@link MockResponsePart} to emit tool
     * calls (and text) in order. The resolver is invoked once per request, so
     * for a tool-call-then-finish flow branch on the round (e.g. a counter or
     * the presence of a tool result in `messages`).
     */
    resolveResponse: (args: {
        messages: readonly vscode.LanguageModelChatMessage[];
        requestOptions?: vscode.LanguageModelChatRequestOptions;
        token?: vscode.CancellationToken;
        promptText: string;
        /** Most recent route id set via {@link setMockRoute} (sticky until changed). */
        route?: string;
    }) => MockResponse | Promise<MockResponse>;
}

/**
 * Flattens a `LanguageModelChatMessage[]` into a single searchable string.
 * Handles string content, structured parts with a string `value` (e.g.
 * `LanguageModelTextPart`), and parts whose own `content` is a nested array of
 * parts (e.g. `LanguageModelToolResultPart`), recursing into them so tool
 * results contribute to the flattened text.
 */
export function languageModelMessagesToText(messages: readonly vscode.LanguageModelChatMessage[]): string {
    const parts: string[] = [];
    const collect = (node: unknown): void => {
        if (typeof node === 'string') {
            parts.push(node);
            return;
        }
        if (!node || typeof node !== 'object') {
            return;
        }
        const value = (node as { value?: unknown }).value;
        if (typeof value === 'string') {
            parts.push(value);
        }
        const nested = (node as { content?: unknown }).content;
        if (Array.isArray(nested)) {
            for (const inner of nested) {
                collect(inner);
            }
        } else if (typeof nested === 'string') {
            parts.push(nested);
        }
    };

    for (const message of messages) {
        const content: unknown = (message as { content?: unknown }).content;
        if (typeof content === 'string') {
            parts.push(content);
        } else if (Array.isArray(content)) {
            for (const part of content) {
                collect(part);
            }
        }
    }

    return parts.join('\n');
}

/** Monotonic counter for synthesizing tool-call ids when a part omits one. */
let mockToolCallSeq = 0;

/** Normalizes a {@link MockResponse} into an ordered list of parts. */
function normalizeMockResponse(response: MockResponse): MockResponsePart[] {
    return typeof response === 'string' ? [{ type: 'text', value: response }] : [...response];
}

/**
 * Creates a deterministic `LanguageModelChat` mock that streams a
 * resolver-provided payload for each request. The payload may contain text
 * and/or tool calls (see {@link MockResponsePart}).
 */
export function createMockLanguageModel(options: CreateMockLanguageModelOptions): vscode.LanguageModelChat {
    // Updated via the symbol-keyed setter (see {@link setMockRoute}) right
    // before each `sendRequest`, then read back inside the resolver below.
    let currentRoute: string | undefined;

    const sendRequest = async (
        messages: vscode.LanguageModelChatMessage[],
        requestOptions?: vscode.LanguageModelChatRequestOptions,
        token?: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelChatResponse> => {
        const promptText = languageModelMessagesToText(messages);
        const parts = normalizeMockResponse(
            await options.resolveResponse({
                messages,
                requestOptions,
                token,
                promptText,
                route: currentRoute,
            }),
        );

        const textChunks = parts.filter((p) => p.type === 'text').map((p) => p.value);

        const textIterable: AsyncIterable<string> = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of textChunks) {
                    yield chunk;
                }
            },
        };
        const streamIterable: AsyncIterable<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = {
            async *[Symbol.asyncIterator]() {
                for (const part of parts) {
                    if (part.type === 'text') {
                        yield new vscode.LanguageModelTextPart(part.value);
                    } else {
                        yield new vscode.LanguageModelToolCallPart(
                            part.callId ?? `mock-call-${++mockToolCallSeq}`,
                            part.name,
                            (part.input ?? {}) as object,
                        );
                    }
                }
            },
        };

        return {
            text: textIterable,
            stream: streamIterable,
        } as vscode.LanguageModelChatResponse;
    };

    const model: vscode.LanguageModelChat = {
        id: options.id,
        name: options.name,
        vendor: options.vendor ?? 'copilot',
        family: options.family ?? 'e2e-mock',
        version: options.version ?? '1.0.0',
        maxInputTokens: options.maxInputTokens ?? 128_000,
        // A length-based estimate is enough for deterministic tests.
        countTokens: (text: string | vscode.LanguageModelChatMessage): Thenable<number> => {
            const input = typeof text === 'string' ? text : languageModelMessagesToText([text]);
            return Promise.resolve(Math.ceil(input.length / 4));
        },
        sendRequest: (
            messages: vscode.LanguageModelChatMessage[],
            requestOptions?: vscode.LanguageModelChatRequestOptions,
            token?: vscode.CancellationToken,
        ): Thenable<vscode.LanguageModelChatResponse> => sendRequest(messages, requestOptions, token),
    };

    (model as unknown as Record<symbol, MockRouteSetter>)[MOCK_ROUTE_SETTER] = (route) => {
        currentRoute = route;
    };

    return model;
}
