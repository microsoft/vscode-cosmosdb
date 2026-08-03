/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { resolveEditorQueries } from './getQueryEditorContextTool';

// `resolveEditorQueries` is pure. Mock the heavy sibling modules the tool file imports (but that this
// function never touches) so the unit under test loads without the panel / service / vscode graph.
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

vi.mock('../services/SchemaService', () => ({
    SchemaService: { getInstance: () => ({ getSimplifiedSchema: vi.fn() }) },
}));

vi.mock('./chatUtils', () => ({
    getActiveQueryEditor: vi.fn(),
    getConnectionFromQueryTab: vi.fn(),
}));

vi.mock('./CosmosDbOperationsService', () => ({
    CosmosDbOperationsService: { getInstance: () => ({ getQueryHistoryContext: vi.fn() }) },
}));

describe('resolveEditorQueries', () => {
    it('uses the selection as both selectedQuery and activeQuery when it has content', () => {
        const result = resolveEditorQueries('SELECT * FROM c', 'SELECT c.id FROM c');

        expect(result.selectedQuery).toBe('SELECT c.id FROM c');
        expect(result.activeQuery).toBe('SELECT c.id FROM c');
    });

    it('ignores a whitespace-only selection and falls back to the full editor text', () => {
        const result = resolveEditorQueries('SELECT * FROM c', '   \n\t ');

        expect(result.selectedQuery).toBeUndefined();
        expect(result.activeQuery).toBe('SELECT * FROM c');
    });

    it('falls back to the full editor text when there is no selection', () => {
        const result = resolveEditorQueries('SELECT * FROM c', undefined);

        expect(result.selectedQuery).toBeUndefined();
        expect(result.activeQuery).toBe('SELECT * FROM c');
    });

    it('returns undefined for both when there is neither editor text nor a selection', () => {
        const result = resolveEditorQueries(undefined, undefined);

        expect(result.selectedQuery).toBeUndefined();
        expect(result.activeQuery).toBeUndefined();
    });

    it('keeps the selection even when the full editor text is empty/undefined', () => {
        const result = resolveEditorQueries(undefined, 'SELECT 1');

        expect(result.selectedQuery).toBe('SELECT 1');
        expect(result.activeQuery).toBe('SELECT 1');
    });

    it('does not trim the returned selection (only uses trim to decide emptiness)', () => {
        const result = resolveEditorQueries('SELECT * FROM c', '  SELECT 1  ');

        expect(result.selectedQuery).toBe('  SELECT 1  ');
        expect(result.activeQuery).toBe('  SELECT 1  ');
    });
});
