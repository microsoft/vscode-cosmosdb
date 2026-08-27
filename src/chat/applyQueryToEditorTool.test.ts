/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as vscode from 'vscode';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { buildFramedQuery, registerApplyQueryToEditorTool } from './applyQueryToEditorTool';
import { captureRegisteredTool, serializeToolResult } from './queryEditorToolTestUtils';
import { getQueryExecutionContext } from './queryExecutionContext';

// Mock the heavy sibling modules so these tests load without pulling in the panel / tRPC / webview graph.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (ctx: unknown) => unknown): Promise<unknown> =>
            callback({
                telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
                errorHandling: { suppressDisplay: false },
                valuesToMask: [] as string[],
            }),
    ),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

vi.mock('../panels/QueryEditorTab', () => ({
    QueryEditorTab: class {
        static openTabs = new Set();
    },
}));

vi.mock('./chatUtils', () => ({
    getActiveQueryEditor: vi.fn(),
    getConnectionFromQueryTab: vi.fn(),
}));

const noopToken = { isCancellationRequested: false } as never;

describe('cosmosdb_applyQueryToEditor — cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        QueryEditorTab.openTabs.clear();
    });

    it('does not update the editor when the invocation is cancelled', async () => {
        const { getActiveQueryEditor } = await import('./chatUtils');
        const updateQuery = vi.fn();
        vi.mocked(getActiveQueryEditor).mockReturnValue({ updateQuery } as never);

        const tool = captureRegisteredTool(registerApplyQueryToEditorTool);
        const cts = new vscode.CancellationTokenSource();
        cts.cancel();

        try {
            const result = await tool.invoke({ input: { query: 'SELECT * FROM c' } }, cts.token);

            expect(serializeToolResult(result)).toBe('Operation cancelled.');
            expect(getActiveQueryEditor).not.toHaveBeenCalled();
            expect(updateQuery).not.toHaveBeenCalled();
        } finally {
            cts.dispose();
        }
    });

    it('rechecks cancellation immediately before updating the editor', async () => {
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');
        const cts = new vscode.CancellationTokenSource();
        const updateQuery = vi.fn();
        const tab = {
            getCurrentQuery: vi.fn(() => {
                cts.cancel();
                return 'SELECT c.id FROM c';
            }),
            takeLastGeneratePrompt: vi.fn(() => undefined),
            updateQuery,
        };
        QueryEditorTab.openTabs.add(tab as never);
        vi.mocked(getActiveQueryEditor).mockReturnValue(tab as never);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue({
            endpoint: 'https://example.test',
            databaseId: 'db',
            containerId: 'container',
        } as never);

        try {
            const tool = captureRegisteredTool(registerApplyQueryToEditorTool);
            const result = await tool.invoke({ input: { query: 'SELECT * FROM c' } }, cts.token);

            expect(serializeToolResult(result)).toBe('Operation cancelled.');
            expect(updateQuery).not.toHaveBeenCalled();
        } finally {
            cts.dispose();
        }
    });
});

describe('cosmosdb_applyQueryToEditor — execution context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        QueryEditorTab.openTabs.clear();
    });

    it('returns a context pinned to the applied query and editor', async () => {
        const { getActiveQueryEditor, getConnectionFromQueryTab } = await import('./chatUtils');
        const connection = {
            endpoint: 'https://example.documents.azure.com/',
            databaseId: 'db',
            containerId: 'container',
        };
        const tab = {
            getId: vi.fn(() => 'tab-1'),
            getCurrentQuery: vi.fn(() => 'SELECT old FROM c'),
            takeLastGeneratePrompt: vi.fn(() => undefined),
            updateQuery: vi.fn(),
        };
        QueryEditorTab.openTabs.add(tab as never);
        vi.mocked(getActiveQueryEditor).mockReturnValue(tab as never);
        vi.mocked(getConnectionFromQueryTab).mockReturnValue(connection as never);

        const tool = captureRegisteredTool(registerApplyQueryToEditorTool);
        const result = await tool.invoke({ input: { query: 'SELECT * FROM c' } }, noopToken);
        const payload = JSON.parse(serializeToolResult(result));
        const executionContext = getQueryExecutionContext(payload.queryContextId);

        expect(tab.updateQuery).toHaveBeenCalledOnce();
        expect(executionContext).toMatchObject({
            tabId: 'tab-1',
            query: 'SELECT * FROM c\n\n-- Previous query:\n-- SELECT old FROM c',
            endpoint: connection.endpoint,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
        });
    });
});

describe('buildFramedQuery', () => {
    it('frames the generated query with a "Generated from" header and a commented "Previous query" block', () => {
        const result = buildFramedQuery('SELECT * FROM c', 'SELECT c.id FROM c ORDER BY c.name', 'find all users');

        expect(result).toBe(
            '-- Generated from: find all users\n' +
                'SELECT * FROM c\n' +
                '\n' +
                '-- Previous query:\n' +
                '-- SELECT c.id FROM c ORDER BY c.name',
        );
    });

    it('omits the header when no prompt description is provided', () => {
        const result = buildFramedQuery('SELECT 1', 'SELECT 2');

        expect(result).toBe('SELECT 1\n\n-- Previous query:\n-- SELECT 2');
        expect(result.startsWith('-- Generated from')).toBe(false);
    });

    it('treats a whitespace-only prompt description as no description', () => {
        const result = buildFramedQuery('SELECT 1', 'SELECT 2', '   ');

        expect(result.startsWith('-- Generated from')).toBe(false);
        expect(result).toBe('SELECT 1\n\n-- Previous query:\n-- SELECT 2');
    });

    it('strips markdown code fences from the generated query', () => {
        const result = buildFramedQuery('```sql\nSELECT * FROM c\n```', 'SELECT 2', 'show all');

        expect(result).not.toContain('```');
        expect(result).toBe('-- Generated from: show all\nSELECT * FROM c\n\n-- Previous query:\n-- SELECT 2');
    });

    it('trims surrounding whitespace from the generated query', () => {
        const result = buildFramedQuery('   SELECT 1   ', 'SELECT 2');

        expect(result).toBe('SELECT 1\n\n-- Previous query:\n-- SELECT 2');
    });

    it('flattens a multi-line prompt description into the single-line comment header', () => {
        const result = buildFramedQuery('SELECT 1', 'SELECT 2', 'find users\nsorted by name');

        const [headerLine] = result.split('\n');
        // Newlines in the description must collapse to spaces so they cannot break out of the
        // single-line `--` comment context.
        expect(headerLine).toBe('-- Generated from: find users sorted by name');
    });

    it('comments out every line of a multi-line previous query', () => {
        const result = buildFramedQuery('SELECT 1', 'SELECT a\nFROM c\nWHERE a > 1');

        expect(result).toBe('SELECT 1\n\n-- Previous query:\n-- SELECT a\n-- FROM c\n-- WHERE a > 1');
    });

    it('does not double-comment previous-query lines that are already comments', () => {
        const result = buildFramedQuery('SELECT 1', 'SELECT a\n-- already a comment');

        expect(result).toContain('-- already a comment');
        expect(result).not.toContain('-- -- already a comment');
    });
});
