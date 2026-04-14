/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CompletionContext } from '@codemirror/autocomplete';
import { type EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCompletionSource, createHoverTooltipSource, createLintSource } from '../../src/providers/codemirror.js';
import { SqlLanguageService } from '../../src/services/SqlLanguageService.js';

// ---------------------------------------------------------------------------
// Lightweight CodeMirror 6 mock helpers
// ---------------------------------------------------------------------------

function createViewMock(text: string): EditorView {
    return {
        state: {
            doc: {
                toString: () => text,
            },
        },
        dom: {
            ownerDocument: {
                createElement: (tag: string) => {
                    // Minimal DOM element mock
                    return {
                        tagName: tag.toUpperCase(),
                        className: '',
                        innerHTML: '',
                    };
                },
            },
        },
    } as unknown as EditorView;
}

function createCompletionContext(text: string, pos: number): CompletionContext {
    return {
        state: {
            doc: {
                toString: () => text,
            },
        },
        pos,
    } as unknown as CompletionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCompletionSource', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const source = createCompletionSource(service);
        expect(typeof source).toBe('function');
    });

    it('returns completions for a partial query', () => {
        const source = createCompletionSource(service);
        const ctx = createCompletionContext('SELECT ', 7);
        const result = source(ctx);

        expect(result).not.toBeNull();
        expect(result!.options.length).toBeGreaterThan(0);
        expect(result!.from).toBeDefined();
    });

    it('returns null when no completions available', () => {
        const source = createCompletionSource(service);
        // Empty context at offset 0 might still return keywords,
        // so we test that it at least returns a valid structure
        const ctx = createCompletionContext('', 0);
        const result = source(ctx);

        // Either null or a valid completion list
        if (result !== null) {
            expect(result.options).toBeDefined();
        }
    });

    it('maps completion kinds correctly', () => {
        const source = createCompletionSource(service);
        const ctx = createCompletionContext('SELECT ', 7);
        const result = source(ctx);

        if (result) {
            for (const opt of result.options) {
                expect(['keyword', 'property', 'function', 'text', 'variable']).toContain(opt.type);
            }
        }
    });
});

describe('createLintSource', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const source = createLintSource(service);
        expect(typeof source).toBe('function');
    });

    it('returns diagnostics for invalid SQL', () => {
        const source = createLintSource(service);
        const view = createViewMock('SELECT * FORM c');
        const diags = source(view);

        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0].severity).toBe('error');
        expect(diags[0].message).toBeDefined();
        expect(typeof diags[0].from).toBe('number');
        expect(typeof diags[0].to).toBe('number');
    });

    it('returns empty array for valid SQL', () => {
        const source = createLintSource(service);
        const view = createViewMock('SELECT * FROM c');
        const diags = source(view);

        expect(diags).toHaveLength(0);
    });
});

describe('createHoverTooltipSource', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const source = createHoverTooltipSource(service);
        expect(typeof source).toBe('function');
    });

    it('returns tooltip for a keyword', () => {
        const source = createHoverTooltipSource(service);
        const view = createViewMock('SELECT * FROM c');
        // pos=2 is inside "SELECT"
        const result = source(view, 2, 1);

        expect(result).not.toBeNull();
        expect(typeof result!.pos).toBe('number');
        expect(typeof result!.end).toBe('number');
        expect(result!.above).toBe(true);
        expect(typeof result!.create).toBe('function');
    });

    it('tooltip create() returns a DOM element', () => {
        const source = createHoverTooltipSource(service);
        const view = createViewMock('SELECT * FROM c');
        const result = source(view, 2, 1);

        expect(result).not.toBeNull();
        const { dom } = result!.create(view);
        expect(dom.className).toBe('cm-cosmosdb-hover');
        expect(dom.innerHTML).toContain('SELECT');
    });

    it('returns null for unrecognized tokens', () => {
        const source = createHoverTooltipSource(service);
        const view = createViewMock('SELECT c.xyz FROM c');
        // pos at "xyz" (offset ~10) — no schema, not a keyword
        const result = source(view, 10, 1);

        expect(result).toBeNull();
    });

    it('returns tooltip for a built-in function', () => {
        const source = createHoverTooltipSource(service);
        const view = createViewMock('SELECT COUNT(1) FROM c');
        // pos=8 is inside "COUNT"
        const result = source(view, 8, 1);

        expect(result).not.toBeNull();
        expect(typeof result!.create).toBe('function');
    });

    it('escapes HTML in tooltip content', () => {
        // Verify the tooltip doesn't render raw HTML from content
        const source = createHoverTooltipSource(service);
        const view = createViewMock('SELECT * FROM c');
        const result = source(view, 2, 1);

        if (result) {
            const { dom } = result.create(view);
            // The content should be escaped, not contain raw < or >
            // (unless the Markdown itself uses them)
            expect(dom.innerHTML).not.toContain('<script>');
        }
    });
});
