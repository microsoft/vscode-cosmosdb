/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { buildFramedQuery } from './applyQueryToEditorTool';

// `buildFramedQuery` only depends on the real sanitization helpers and `@vscode/l10n`. Mock the
// heavy sibling modules the tool file imports (but that this function never touches) so the unit
// under test loads fast and deterministically without pulling in the panel / tRPC / webview graph.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
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
