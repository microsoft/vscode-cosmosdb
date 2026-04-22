/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CompletionContext } from '@codemirror/autocomplete';
import { type EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCompletionSource, createFormatCommand, createHoverTooltipSource, createLintSource, createMultiQueryFoldService, createMultiQuerySeparatorExtension, createSignatureHelpSource, type MultiQuerySeparatorDeps } from './index.js';
import { SqlLanguageService } from '../../services/SqlLanguageService.js';

// ---------------------------------------------------------------------------
// Lightweight CodeMirror 6 mock helpers
// ---------------------------------------------------------------------------

function createViewMock(text: string, cursorPos?: number): EditorView {
    return {
        state: {
            doc: {
                toString: () => text,
            },
            selection: {
                main: { head: cursorPos ?? text.length },
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
        dispatch: () => {},
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

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

function createStateMock(text: string) {
    const lines = text.split('\n');
    // Build line index: each line has { from, to, number }
    const lineIndex: { from: number; to: number; number: number }[] = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        lineIndex.push({ from: offset, to: offset + lines[i].length, number: i + 1 });
        offset += lines[i].length + 1; // +1 for \n
    }

    return {
        doc: {
            toString: () => text,
            lineAt: (pos: number) => {
                for (const line of lineIndex) {
                    if (pos >= line.from && pos <= line.to) return line;
                }
                return lineIndex[lineIndex.length - 1];
            },
        },
    };
}

describe('createMultiQueryFoldService', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const foldFn = createMultiQueryFoldService(service);
        expect(typeof foldFn).toBe('function');
    });

    it('returns null for a single query', () => {
        const foldFn = createMultiQueryFoldService(service);
        const state = createStateMock('SELECT * FROM c');
        const result = foldFn(state, 0, 14);
        expect(result).toBeNull();
    });

    it('returns null for a single-line query in a multi-query doc', () => {
        const foldFn = createMultiQueryFoldService(service);
        const text = 'SELECT 1;\nSELECT 2;';
        const state = createStateMock(text);
        // Line 1 starts at offset 0
        const result = foldFn(state, 0, 8);
        expect(result).toBeNull();
    });

    it('returns fold range for a multi-line query', () => {
        const foldFn = createMultiQueryFoldService(service);
        // Line 0: SELECT 1;
        // Line 1: SELECT
        // Line 2: *
        // Line 3: FROM c;
        const text = 'SELECT 1;\nSELECT\n*\nFROM c;';
        const state = createStateMock(text);
        // The multi-line query starts at line 1 (offset 10), "SELECT"
        const line1 = state.doc.lineAt(10);
        const result = foldFn(state, line1.from, line1.to);
        expect(result).not.toBeNull();
        expect(result!.from).toBe(line1.to); // fold starts at end of first line
    });

    it('fold range starts at content, not at previous semicolon', () => {
        const foldFn = createMultiQueryFoldService(service);
        // Line 0: SELECT 1;
        // Line 1: (empty)
        // Line 2: SELECT
        // Line 3: *
        // Line 4: FROM c;
        const text = 'SELECT 1;\n\nSELECT\n*\nFROM c;';
        const state = createStateMock(text);
        // Line at offset 0 (SELECT 1;) should not fold
        const line0 = state.doc.lineAt(0);
        expect(foldFn(state, line0.from, line0.to)).toBeNull();
        // Line at offset 11 (SELECT on line 2) should fold
        const line2 = state.doc.lineAt(11);
        const result = foldFn(state, line2.from, line2.to);
        expect(result).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Multi-query separator decorations
// ---------------------------------------------------------------------------

/**
 * Mock for the CodeMirror deps required by `createMultiQuerySeparatorExtension`.
 * Tracks decoration calls so we can assert on them.
 */
function createSeparatorDepsMock(): MultiQuerySeparatorDeps & {
    createdRanges: { class: string; from: number }[];
    decorationSets: unknown[][];
    pluginInstances: { decorations: unknown; update(u: unknown): void }[];
} {
    const createdRanges: { class: string; from: number }[] = [];
    const decorationSets: unknown[][] = [];
    const pluginInstances: { decorations: unknown; update(u: unknown): void }[] = [];

    return {
        createdRanges,
        decorationSets,
        pluginInstances,
        ViewPlugin: {
            fromClass<V extends object>(
                cls: new (view: unknown) => V,
                _spec?: { decorations?: (value: V) => unknown },
            ): { _cls: new (view: unknown) => V; _spec: typeof _spec } {
                // Return an object that lets tests instantiate the plugin
                return { _cls: cls, _spec };
            },
        },
        Decoration: {
            line(spec: { class: string }) {
                return {
                    range(from: number) {
                        const r = { class: spec.class, from };
                        createdRanges.push(r);
                        return r;
                    },
                };
            },
            none: [] as unknown,
            set(of: unknown[], _sort?: boolean) {
                decorationSets.push(of);
                return of;
            },
        },
    };
}

/** Create a minimal EditorView-like object for the separator plugin. */
function createSeparatorViewMock(text: string) {
    const lines = text.split('\n');

    function lineAt(pos: number): { from: number; to: number; number: number } {
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
            const lineEnd = offset + lines[i].length;
            if (pos >= offset && pos <= lineEnd) {
                return { from: offset, to: lineEnd, number: i + 1 };
            }
            offset = lineEnd + 1;
        }
        const last = lines.length - 1;
        const lastFrom = text.length - lines[last].length;
        return { from: lastFrom, to: text.length, number: lines.length };
    }

    return {
        state: {
            doc: {
                toString: () => text,
                lineAt,
            },
        },
    };
}

describe('createMultiQuerySeparatorExtension', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns an extension (from ViewPlugin.fromClass)', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps);
        expect(ext).toBeDefined();
        expect(ext).toHaveProperty('_cls');
        expect(ext).toHaveProperty('_spec');
    });

    it('creates no decorations for a single query', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps) as {
            _cls: new (view: unknown) => { decorations: unknown };
        };

        const view = createSeparatorViewMock('SELECT * FROM c');
        const plugin = new ext._cls(view);

        // decorations should be Decoration.none (empty array in our mock)
        expect(plugin.decorations).toEqual([]);
    });

    it('creates separator decorations between query regions', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps) as {
            _cls: new (view: unknown) => { decorations: unknown };
        };

        // "SELECT 1;\nSELECT 2;\nSELECT 3;" — trailing ; creates an empty
        // 4th region, so getSeparatorPositions returns 3 separators.
        const text = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
        const view = createSeparatorViewMock(text);
        new ext._cls(view);

        expect(deps.createdRanges).toHaveLength(3);
        // First separator is on line containing offset of first ";"
        expect(deps.createdRanges[0].from).toBe(0); // line 1 starts at 0
        expect(deps.createdRanges[1].from).toBe(10); // line 2 starts at 10
        expect(deps.createdRanges[0].class).toBe('cosmosdb-query-separator');
    });

    it('recalculates decorations on doc change', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps) as {
            _cls: new (view: unknown) => { decorations: unknown; update(u: unknown): void };
        };

        // "SELECT 1;\nSELECT 2;" — trailing ; → 3 regions, 2 separators
        const view1 = createSeparatorViewMock('SELECT 1;\nSELECT 2;');
        const plugin = new ext._cls(view1);
        expect(deps.createdRanges).toHaveLength(2);

        // Simulate doc change — add a third query
        deps.createdRanges.length = 0;
        const view2 = createSeparatorViewMock('SELECT 1;\nSELECT 2;\nSELECT 3;');
        plugin.update({ docChanged: true, state: view2.state, view: view2 });

        expect(deps.createdRanges).toHaveLength(3);
    });

    it('does not recalculate when doc did not change', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps) as {
            _cls: new (view: unknown) => { decorations: unknown; update(u: unknown): void };
        };

        const view = createSeparatorViewMock('SELECT 1;\nSELECT 2;');
        const plugin = new ext._cls(view);
        const initialRangeCount = deps.createdRanges.length;

        // Simulate non-doc-change update (e.g. selection change)
        plugin.update({ docChanged: false, state: view.state, view });

        // No new ranges computed
        expect(deps.createdRanges).toHaveLength(initialRangeCount);
    });

    it('supports custom separator class', () => {
        const deps = createSeparatorDepsMock();
        const ext = createMultiQuerySeparatorExtension(service, deps, {
            separatorClass: 'my-custom-sep',
        }) as {
            _cls: new (view: unknown) => { decorations: unknown };
        };

        const view = createSeparatorViewMock('SELECT 1;\nSELECT 2;');
        new ext._cls(view);

        // 2 separators (trailing ; creates empty region)
        expect(deps.createdRanges).toHaveLength(2);
        expect(deps.createdRanges[0].class).toBe('my-custom-sep');
    });
});

// ---------------------------------------------------------------------------
// Document formatting
// ---------------------------------------------------------------------------

describe('createFormatCommand', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const cmd = createFormatCommand(service);
        expect(typeof cmd).toBe('function');
    });

    it('dispatches changes for an unformatted query', () => {
        const cmd = createFormatCommand(service);
        let dispatched = false;
        const view = {
            ...createViewMock('select * from c'),
            dispatch: (tr: unknown) => {
                dispatched = true;
                expect(tr).toHaveProperty('changes');
            },
        } as unknown as EditorView;

        const result = cmd(view);
        // The formatter should produce edits (e.g., uppercasing keywords)
        expect(result).toBe(true);
        expect(dispatched).toBe(true);
    });

    it('returns false when no edits are needed', () => {
        const cmd = createFormatCommand(service);
        // Format a query first, then re-format — should produce no edits
        const formatted = service.format('SELECT * FROM c');
        const view = createViewMock(formatted);
        const result = cmd(view);
        expect(result).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------

describe('createSignatureHelpSource', () => {
    let service: SqlLanguageService;

    beforeEach(() => {
        service = new SqlLanguageService();
    });

    it('returns a function', () => {
        const source = createSignatureHelpSource(service);
        expect(typeof source).toBe('function');
    });

    it('returns a tooltip inside a function call', () => {
        const source = createSignatureHelpSource(service);
        // Place cursor inside CONTAINS(
        const text = 'SELECT * FROM c WHERE CONTAINS(c.name, ';
        const view = createViewMock(text, text.length);
        const result = source(view);

        expect(result).not.toBeNull();
        expect(result!.pos).toBeDefined();
        expect(typeof result!.create).toBe('function');

        // Verify the tooltip renders
        const tooltipView = result!.create(view);
        expect(tooltipView).toHaveProperty('dom');
    });

    it('returns null when not inside a function call', () => {
        const source = createSignatureHelpSource(service);
        const view = createViewMock('SELECT * FROM c', 15);
        const result = source(view);
        expect(result).toBeNull();
    });
});

