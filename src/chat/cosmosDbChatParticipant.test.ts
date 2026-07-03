/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { CosmosDbChatParticipant } from './cosmosDbChatParticipant';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// The chat view / Copilot cannot be driven headlessly, so these tests exercise
// the participant's request handler directly: a fake ChatRequest + a stubbed
// ChatResponseStream, with the LLM-facing collaborators mocked. This verifies
// command dispatch, the general-question path, and that editQuery renders the
// two action buttons (whose runtime behavior is covered by the e2e spec).

// The freeform (`/question`) path loads the best-practices skill from disk; the
// fake extensionPath has none, so stub `readFileSync` (keeping the rest of `fs`
// real) to keep it off the FS and out of stderr. Empty content = "no docs".
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return { ...actual, readFileSync: vi.fn(() => '') };
});

// Run the wrapped callback with a minimal mutable telemetry context.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_eventName: string, callback: (ctx: unknown) => unknown) =>
        callback({
            errorHandling: {},
            telemetry: { properties: {}, measurements: {} },
        }),
    ),
}));

vi.mock('../utils/copilotUtils', () => ({
    areAIFeaturesEnabled: vi.fn(async () => true),
}));

vi.mock('../utils/aiUtils', () => ({
    getSelectedModel: vi.fn(),
    extractJsonObject: vi.fn(),
}));

vi.mock('./chatUtils', () => ({
    sendChatRequest: vi.fn(),
    getActiveQueryEditor: vi.fn((tabs: unknown[]) => tabs[0]),
    getConnectionFromQueryTab: vi.fn(() => undefined),
}));

// Stable singleton stub so tests can configure `executeOperation` per case.
const mockOperationsService = vi.hoisted(() => ({
    executeOperation: vi.fn(),
    getActiveEditorQuery: vi.fn(() => ''),
    getQueryHistoryContext: vi.fn(() => undefined),
}));

vi.mock('./CosmosDbOperationsService', () => ({
    CosmosDbOperationsService: { getInstance: () => mockOperationsService },
}));

vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: { openTabs: new Set() },
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

/** A stubbed `ChatResponseStream` capturing `markdown` / `button` calls. */
function makeStream() {
    return {
        markdown: vi.fn(),
        button: vi.fn(),
        progress: vi.fn(),
        anchor: vi.fn(),
        reference: vi.fn(),
        filetree: vi.fn(),
        push: vi.fn(),
    } as unknown as vscode.ChatResponseStream & {
        markdown: ReturnType<typeof vi.fn>;
        button: ReturnType<typeof vi.fn>;
    };
}

function makeToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => undefined }),
    } as unknown as vscode.CancellationToken;
}

function makeRequest(overrides: Partial<{ prompt: string; command: string; model: unknown }>): vscode.ChatRequest {
    return {
        prompt: '',
        command: undefined,
        references: [],
        ...overrides,
    } as unknown as vscode.ChatRequest;
}

/** Concatenates every string passed to `stream.markdown`. */
function markdownText(stream: ReturnType<typeof makeStream>): string {
    return stream.markdown.mock.calls.map((c) => String(c[0])).join('');
}

async function invoke(
    participant: CosmosDbChatParticipant,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
): Promise<void> {
    // handleChatRequest is private; the participant exposes it only via the
    // registered handler, so reach it directly for unit testing.
    await (participant as unknown as { handleChatRequest: (...args: unknown[]) => Promise<unknown> }).handleChatRequest(
        request,
        {},
        stream,
        makeToken(),
    );
}

const MOCK_CONNECTION = { endpoint: 'https://localhost:8081', databaseId: 'db1', containerId: 'c1' };

describe('CosmosDbChatParticipant', () => {
    let participant: CosmosDbChatParticipant;

    beforeEach(async () => {
        // The constructor calls vscode.chat.createChatParticipant; provide a stub.
        (vscode as unknown as { chat: unknown }).chat = {
            createChatParticipant: vi.fn(() => ({ iconPath: undefined, dispose: vi.fn() })),
        };
        if (!(vscode.Uri as unknown as { joinPath?: unknown }).joinPath) {
            (vscode.Uri as unknown as { joinPath: (...a: unknown[]) => unknown }).joinPath = (base) => base;
        }

        CosmosDbChatParticipant.pendingResults.clear();
        const { QueryEditorTab } = await import('../panels/QueryEditorTab');
        (QueryEditorTab.openTabs as Set<unknown>).clear();

        const { getSelectedModel } = vi.mocked(await import('../utils/aiUtils'));
        getSelectedModel.mockReset();
        // Structured commands try getSelectedModel for param extraction; returning
        // null makes them fall back to basic extraction (no extra LLM mocking).
        getSelectedModel.mockResolvedValue(null as unknown as vscode.LanguageModelChat);

        mockOperationsService.executeOperation.mockReset();
        mockOperationsService.getActiveEditorQuery.mockReset();
        mockOperationsService.getActiveEditorQuery.mockReturnValue('');

        const context = {
            extensionPath: '/fake-extension',
            extensionUri: vscode.Uri.file('/fake-extension'),
            subscriptions: [] as unknown[],
        } as unknown as vscode.ExtensionContext;
        participant = new CosmosDbChatParticipant(context);
    });

    it('bails out when AI features are unavailable', async () => {
        const { areAIFeaturesEnabled } = vi.mocked(await import('../utils/copilotUtils'));
        areAIFeaturesEnabled.mockResolvedValueOnce(false);

        const stream = makeStream();
        await invoke(participant, makeRequest({ command: 'help' }), stream);

        expect(markdownText(stream)).toContain('AI features are currently unavailable');
    });

    describe('/help', () => {
        it('lists every slash command without calling the LLM', async () => {
            const stream = makeStream();
            await invoke(participant, makeRequest({ command: 'help' }), stream);

            const text = markdownText(stream);
            expect(text).toContain('/editQuery');
            expect(text).toContain('/explainQuery');
            expect(text).toContain('/generateQuery');
            expect(text).toContain('/question');
            expect(text).toContain('/help');
            expect(mockOperationsService.executeOperation).not.toHaveBeenCalled();
        });
    });

    describe('/question (general question)', () => {
        it('streams the LLM answer back to the chat', async () => {
            const { sendChatRequest } = vi.mocked(await import('./chatUtils'));
            sendChatRequest.mockResolvedValue({
                text: (async function* () {
                    yield 'A partition key ';
                    yield 'distributes data across partitions.';
                })(),
            } as unknown as vscode.LanguageModelChatResponse);

            const stream = makeStream();
            await invoke(
                participant,
                makeRequest({ command: 'question', prompt: 'what is a partition key?', model: {} }),
                stream,
            );

            expect(sendChatRequest).toHaveBeenCalledTimes(1);
            const text = markdownText(stream);
            expect(text).toContain('A partition key');
            expect(text).toContain('distributes data across partitions.');
        });
    });

    describe('/explainQuery', () => {
        it('explains an inline query (no connection required)', async () => {
            mockOperationsService.executeOperation.mockResolvedValue(
                '## Query Analysis\n\nThis query returns all documents.',
            );

            const stream = makeStream();
            await invoke(participant, makeRequest({ command: 'explainQuery', prompt: 'SELECT * FROM c' }), stream);

            expect(mockOperationsService.executeOperation).toHaveBeenCalledWith(
                'explainQuery',
                expect.objectContaining({ currentQuery: 'SELECT * FROM c' }),
                expect.any(Function),
                expect.any(Function),
                'chatParticipant',
            );
            expect(markdownText(stream)).toContain('Query Analysis');
        });
    });

    describe('/generateQuery', () => {
        it('renders the generated query and action buttons', async () => {
            const { QueryEditorTab } = await import('../panels/QueryEditorTab');
            (QueryEditorTab.openTabs as Set<unknown>).add({});

            mockOperationsService.executeOperation.mockResolvedValue({
                type: 'editQuery',
                currentQuery: undefined,
                suggestedQuery: 'SELECT * FROM c WHERE c.active = true',
                explanation: 'Generated a filter query.',
                connection: MOCK_CONNECTION,
                queryContext: { databaseId: 'db1', containerId: 'c1' },
            });

            const stream = makeStream();
            await invoke(participant, makeRequest({ command: 'generateQuery', prompt: 'find active items' }), stream);

            expect(mockOperationsService.executeOperation).toHaveBeenCalledWith(
                'generateQuery',
                expect.any(Object),
                expect.any(Function),
                expect.any(Function),
                'chatParticipant',
            );
            expect(markdownText(stream)).toContain('SELECT * FROM c WHERE c.active = true');
            // generateQuery has no "current query" to show.
            expect(markdownText(stream)).not.toContain('**Current Query:**');
            expect(stream.button).toHaveBeenCalledTimes(2);
        });
    });

    describe('/editQuery', () => {
        it('shows the suggested query and both action buttons, storing a pending result', async () => {
            const { QueryEditorTab } = await import('../panels/QueryEditorTab');
            (QueryEditorTab.openTabs as Set<unknown>).add({});
            mockOperationsService.getActiveEditorQuery.mockReturnValue('SELECT * FROM c');

            mockOperationsService.executeOperation.mockResolvedValue({
                type: 'editQuery',
                currentQuery: 'SELECT * FROM c',
                suggestedQuery: 'SELECT * FROM c WHERE c.active = true',
                explanation: 'Added an active filter.',
                connection: MOCK_CONNECTION,
                queryContext: { databaseId: 'db1', containerId: 'c1' },
            });

            const stream = makeStream();
            await invoke(participant, makeRequest({ command: 'editQuery', prompt: 'only active rows' }), stream);

            const text = markdownText(stream);
            expect(text).toContain('**Current Query:**');
            expect(text).toContain('SELECT * FROM c WHERE c.active = true');

            // Both buttons wired to their commands with a lightweight result id.
            expect(stream.button).toHaveBeenCalledTimes(2);
            const buttonArgs = stream.button.mock.calls.map((c) => c[0] as { command: string; arguments: unknown[] });
            const apply = buttonArgs.find((b) => b.command === 'cosmosDB.applyQuerySuggestion');
            const sideBySide = buttonArgs.find((b) => b.command === 'cosmosDB.openQuerySideBySide');
            expect(apply).toBeDefined();
            expect(sideBySide).toBeDefined();

            // Both buttons reference the same pending result id, stored for lookup.
            const resultId = apply!.arguments[0] as number;
            expect(sideBySide!.arguments[0]).toBe(resultId);
            expect(CosmosDbChatParticipant.pendingResults.get(resultId)).toEqual({
                connection: MOCK_CONNECTION,
                suggestedQuery: 'SELECT * FROM c WHERE c.active = true',
            });
        });
    });
});
