/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// CodeMirror 6 provider adapter for @cosmosdb/nosql-language-service
//
// Usage:
//   import { SqlLanguageService } from "@cosmosdb/nosql-language-service";
//   import { cosmosDbSqlSupport } from "@cosmosdb/nosql-language-service/codemirror";
//
//   const service = new SqlLanguageService({ getSchema: () => schema });
//   const extensions = cosmosDbSqlSupport(service);
//   // Pass `extensions` to CodeMirror's EditorState.create({ extensions })
//
// This module does NOT import "@codemirror/*" — it provides factory
// functions that return plain objects consumable by CodeMirror 6.
// The consumer must have @codemirror/autocomplete, @codemirror/lint, etc.
// ---------------------------------------------------------------------------

import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { type StreamParser, type StringStream } from '@codemirror/language';
import { type Diagnostic } from '@codemirror/lint';
import { type EditorView, type Tooltip, type TooltipView, type ViewUpdate } from '@codemirror/view';
import { SQL_KEYWORDS } from '../lexer/tokens.js';
import { FUNCTION_SIGNATURES, type SqlLanguageService } from '../services/index.js';
import { DiagnosticSeverity as DsSeverity } from '../services/types.js';

// ========================== Public types ======================================

/**
 * Options for the CodeMirror integration.
 */
export interface CodeMirrorOptions {
    /**
     * Whether to enable autocompletion.
     * @default true
     */
    completions?: boolean;

    /**
     * Whether to enable lint diagnostics.
     * @default true
     */
    diagnostics?: boolean;

    /**
     * Whether to enable hover tooltips.
     * @default true
     */
    hover?: boolean;
}

// ========================== Completion source =================================

/**
 * Create a CodeMirror 6 autocompletion source function.
 *
 * Returns a function compatible with `@codemirror/autocomplete`'s
 * `CompletionSource` type.
 *
 * @example
 * ```typescript
 * import { autocompletion } from "@codemirror/autocomplete";
 *
 * const source = createCompletionSource(service);
 * const ext = autocompletion({ override: [source] });
 * ```
 */
export function createCompletionSource(
    service: SqlLanguageService,
): (context: CompletionContext) => CompletionResult | null {
    return (context: CompletionContext) => {
        const query: string = context.state.doc.toString();
        const offset: number = context.pos;

        const items = service.getCompletions(query, offset);
        if (items.length === 0) return null;

        // Determine the start of the current word for the "from" position
        const before = query.substring(0, offset);
        const wordMatch = before.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        const from = wordMatch ? offset - wordMatch[0].length : offset;

        return {
            from,
            options: items.map((item) => ({
                label: item.label,
                type: mapCompletionKind(item.kind),
                detail: item.detail,
                apply: item.insertText ?? item.label,
                boost: item.sortText ? 1000 - parseInt(item.sortText.substring(0, 4), 10) : 0,
            })),
        };
    };
}

// ========================== Lint source =======================================

/**
 * Create a CodeMirror 6 lint source function.
 *
 * Returns a function compatible with `@codemirror/lint`'s
 * `LintSource` type.
 *
 * @example
 * ```typescript
 * import { linter } from "@codemirror/lint";
 *
 * const source = createLintSource(service);
 * const ext = linter(source);
 * ```
 */
export function createLintSource(service: SqlLanguageService): (view: EditorView) => Diagnostic[] {
    return (view: EditorView) => {
        const query: string = view.state.doc.toString();
        const diags = service.getDiagnostics(query);

        return diags.map((d) => ({
            from: d.range.startOffset,
            to: d.range.endOffset,
            severity: mapSeverity(d.severity),
            message: d.message,
            source: d.source ?? 'cosmosdb-sql',
        }));
    };
}

// ========================== Hover tooltip source ==============================

/**
 * Create a CodeMirror 6 hover tooltip source function.
 *
 * Returns a function compatible with `@codemirror/view`'s
 * `hoverTooltip` extension.
 *
 * @example
 * ```typescript
 * import { hoverTooltip } from "@codemirror/view";
 *
 * const source = createHoverTooltipSource(service);
 * const ext = hoverTooltip(source);
 * ```
 */
export function createHoverTooltipSource(
    service: SqlLanguageService,
): (view: EditorView, pos: number, side: number) => Tooltip | null {
    return (view: EditorView, pos: number, _side: number) => {
        const query: string = view.state.doc.toString();
        const info = service.getHoverInfo(query, pos);
        if (!info) return null;

        return {
            pos: info.range?.startOffset ?? pos,
            end: info.range?.endOffset ?? pos,
            above: true,
            create(_view: EditorView): TooltipView {
                // DOM access requires browser types unavailable in this package's TS config;
                // cast through unknown to satisfy the lint rule for environment-agnostic build.
                const viewDom = _view.dom as unknown as Record<string, unknown>;
                const ownerDoc = viewDom['ownerDocument'] as { createElement(tag: string): Record<string, unknown> };
                const dom = ownerDoc.createElement('div');
                dom['className'] = 'cm-cosmosdb-hover';
                dom['innerHTML'] = info.contents.map((c: string) => `<div>${escapeHtml(c)}</div>`).join('');
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                return { dom: dom as unknown as TooltipView['dom'] };
            },
        };
    };
}

/**
 * Escape HTML special characters for safe rendering in tooltips.
 */
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========================== Document formatting ===============================

/**
 * Create a CodeMirror 6 command that formats the entire document using
 * the language service's formatter.
 *
 * Returns a function compatible with CodeMirror's `Command` type
 * (`(view: EditorView) => boolean`). Bind it to a keybinding or
 * call it from a toolbar button.
 *
 * @example
 * ```typescript
 * import { keymap } from "@codemirror/view";
 *
 * const formatCommand = createFormatCommand(service);
 * const ext = keymap.of([{ key: "Shift-Alt-f", run: formatCommand }]);
 * ```
 */
export function createFormatCommand(service: SqlLanguageService): (view: EditorView) => boolean {
    return (view: EditorView) => {
        const query: string = view.state.doc.toString();
        const edits = service.getFormatEdits(query);
        if (edits.length === 0) return false;

        // Convert TextEdit[] to CodeMirror ChangeSpec[],
        // applying edits in reverse order to keep offsets stable.
        const changes = edits
            .slice()
            .sort((a, b) => b.range.startOffset - a.range.startOffset)
            .map((e) => ({
                from: e.range.startOffset,
                to: e.range.endOffset,
                insert: e.newText,
            }));

        view.dispatch({ changes });
        return true;
    };
}

// ========================== Signature help ====================================

/**
 * Create a CodeMirror 6 extension that shows function signature tooltips
 * when the cursor is inside a function call (after `(` or `,`).
 *
 * Returns a function compatible with `@codemirror/view`'s
 * `hoverTooltip`-like pattern, but designed to be used with
 * `EditorView.updateListener` for cursor-driven updates.
 *
 * The simplest integration is via `createSignatureHelpTooltipExtension`,
 * which wires everything up as a single extension.
 *
 * @example
 * ```typescript
 * import { ViewPlugin, Decoration } from "@codemirror/view";
 *
 * const ext = createSignatureHelpTooltipExtension(service, {
 *   ViewPlugin,
 *   showTooltip,           // from @codemirror/view
 *   StateField,            // from @codemirror/state
 *   EditorView: EditorView // from @codemirror/view
 * });
 * ```
 */
export function createSignatureHelpSource(
    service: SqlLanguageService,
): (view: EditorView) => Tooltip | null {
    return (view: EditorView) => {
        const query: string = view.state.doc.toString();
        const offset: number = view.state.selection.main.head;
        const result = service.getSignatureHelp(query, offset);
        if (!result || result.signatures.length === 0) return null;

        const sig = result.signatures[result.activeSignature] ?? result.signatures[0];
        if (!sig) return null;

        return {
            pos: offset,
            above: true,
            strictSide: false,
            create(_view: EditorView): TooltipView {
                const viewDom = _view.dom as unknown as Record<string, unknown>;
                const ownerDoc = viewDom['ownerDocument'] as { createElement(tag: string): Record<string, unknown> };

                const dom = ownerDoc.createElement('div');
                dom['className'] = 'cm-cosmosdb-signature-help';

                // Build the signature label with the active parameter highlighted
                let html = `<div class="cm-cosmosdb-sig-label">`;
                const params = sig.parameters;
                const activeIdx = result.activeParameter;

                if (params.length > 0) {
                    // Build label with highlighted active param
                    const parts: string[] = [];
                    const funcName = sig.label.substring(0, sig.label.indexOf('('));
                    html += `${escapeHtml(funcName)}(`;
                    for (let i = 0; i < params.length; i++) {
                        const paramLabel = escapeHtml(params[i].label);
                        if (i === activeIdx) {
                            parts.push(`<strong>${paramLabel}</strong>`);
                        } else {
                            parts.push(paramLabel);
                        }
                    }
                    html += parts.join(', ');
                    html += `)`;
                } else {
                    html += escapeHtml(sig.label);
                }
                html += `</div>`;

                // Add documentation for active parameter
                const activeParam = params[activeIdx];
                if (activeParam?.documentation) {
                    html += `<div class="cm-cosmosdb-sig-doc">${escapeHtml(activeParam.documentation)}</div>`;
                } else if (sig.documentation) {
                    html += `<div class="cm-cosmosdb-sig-doc">${escapeHtml(sig.documentation)}</div>`;
                }

                dom['innerHTML'] = html;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                return { dom: dom as unknown as TooltipView['dom'] };
            },
        };
    };
}

// ========================== Folding ==========================================

/**
 * Create a fold callback for multi-query documents that can be used
 * with CodeMirror 6's `foldService` from `@codemirror/language`.
 *
 * Each non-empty query region (between semicolons) that spans multiple
 * lines becomes a foldable range.
 *
 * @example
 * ```typescript
 * import { foldService } from "@codemirror/language";
 *
 * const foldFn = createMultiQueryFoldService(service);
 * const ext = foldService.of(foldFn);
 * ```
 */
export function createMultiQueryFoldService(
    service: SqlLanguageService,
): (state: { doc: { toString(): string; lineAt(pos: number): { from: number; to: number; number: number } } }, lineStart: number, lineEnd: number) => { from: number; to: number } | null {
    return (state, lineStart, _lineEnd) => {
        const text = state.doc.toString();
        const foldable = service.getFoldableRegions(text);

        // Find which foldable region starts on the requested line
        for (const region of foldable) {
            const startLine = state.doc.lineAt(region.contentStartOffset);
            if (startLine.from !== lineStart) continue;

            // Region must span multiple lines to be foldable
            const endLine = state.doc.lineAt(region.contentEndOffset);
            if (endLine.number <= startLine.number) return null;

            return { from: startLine.to, to: endLine.to };
        }
        return null;
    };
}

// ========================== Multi-query separator decorations ==================

/**
 * CSS class name for the separator line between query regions.
 * Matches the Monaco decorator for consistent styling.
 */
const SEPARATOR_CLASS = 'cosmosdb-query-separator';

/**
 * Injects a `<style>` element with the default separator CSS rule.
 * Identical to the Monaco variant — only injects once per document.
 */
function ensureSeparatorStyles(): void {
    /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
    const g = globalThis as any;
    if (!g?.document?.createElement) return;
    const STYLE_ID = 'cosmosdb-multiquery-styles';
    if (g.document.getElementById(STYLE_ID)) return;
    const style = g.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        `.${SEPARATOR_CLASS} {`,
        `  border-bottom: 2px solid var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060));`,
        `  padding-bottom: 8px;`,
        `}`,
    ].join('\n');
    g.document.head.appendChild(style);
    /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
}

/**
 * Minimal subset of `@codemirror/view` and `@codemirror/state` symbols needed
 * at **runtime** by the separator extension.
 *
 * Because this module avoids runtime `@codemirror/*` imports (only type-only
 * imports are used), the consumer must pass the real objects at call-site.
 *
 * @example
 * ```typescript
 * import { ViewPlugin, Decoration } from "@codemirror/view";
 *
 * const ext = createMultiQuerySeparatorExtension(service, { ViewPlugin, Decoration });
 * ```
 */
export interface MultiQuerySeparatorDeps {
    /** `ViewPlugin` from `@codemirror/view`. */
    ViewPlugin: {
        fromClass<V extends object>(
            cls: new (view: EditorView) => V,
            spec?: { decorations?: (value: V) => unknown },
        ): unknown; // Extension
    };
    /** `Decoration` from `@codemirror/view`. */
    Decoration: {
        /** Create a line-level decoration. */
        line(spec: { class: string }): { range(from: number): unknown };
        /** Empty decoration set. */
        none: unknown;
        /** Build a `DecorationSet` from an array of positioned ranges. */
        set(of: unknown[], sort?: boolean): unknown;
    };
}

/**
 * Create a CodeMirror 6 extension that renders horizontal separator lines
 * between query regions in a multi-query document.
 *
 * The extension is a `ViewPlugin` that recomputes line decorations whenever
 * the document changes, using {@link SqlLanguageService.getSeparatorPositions}.
 *
 * @param service  - A configured {@link SqlLanguageService}.
 * @param deps     - Runtime CodeMirror primitives (see {@link MultiQuerySeparatorDeps}).
 * @param options  - Optional overrides.
 * @returns A CodeMirror `Extension` (opaque — pass directly to `EditorState.create`).
 *
 * @example
 * ```typescript
 * import { ViewPlugin, Decoration } from "@codemirror/view";
 *
 * const ext = createMultiQuerySeparatorExtension(service, { ViewPlugin, Decoration });
 * // Pass `ext` to EditorState.create({ extensions: [ext, ...] })
 * ```
 */
export function createMultiQuerySeparatorExtension(
    service: SqlLanguageService,
    deps: MultiQuerySeparatorDeps,
    options?: { separatorClass?: string },
): unknown {
    ensureSeparatorStyles();

    const className = options?.separatorClass ?? SEPARATOR_CLASS;
    const lineDeco = deps.Decoration.line({ class: className });

    function buildDecorations(doc: { toString(): string; lineAt(pos: number): { from: number } }): unknown {
        const text = doc.toString();
        const separators = service.getSeparatorPositions(text);

        if (separators.length === 0) return deps.Decoration.none;

        const ranges: unknown[] = [];
        for (const sep of separators) {
            const line = doc.lineAt(sep.semicolonOffset);
            ranges.push(lineDeco.range(line.from));
        }
        return deps.Decoration.set(ranges, true);
    }

    // Build a ViewPlugin class that CodeMirror will instantiate per-view.
    type Doc = { toString(): string; lineAt(pos: number): { from: number } };

    class SeparatorPlugin {
        decorations: unknown;

        constructor(view: EditorView) {
            // EditorView.state.doc satisfies Doc but is typed opaquely;
            // cast through unknown to stay runtime-safe.
            this.decorations = buildDecorations(view.state.doc as unknown as Doc);
        }

        update(update: ViewUpdate) {
            if (update.docChanged) {
                this.decorations = buildDecorations(update.state.doc as unknown as Doc);
            }
        }
    }

    return deps.ViewPlugin.fromClass(SeparatorPlugin as unknown as new (view: EditorView) => SeparatorPlugin, {
        decorations: (v: SeparatorPlugin) => v.decorations,
    });
}

// ========================== Syntax highlighting (StreamParser) =================

/** Word-based operators (case-insensitive). */
const CM_OPERATORS = new Set(['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'LIKE', 'EXISTS']);

/** Built-in function names (case-insensitive). */
const CM_BUILTINS = new Set(Object.keys(FUNCTION_SIGNATURES).map((n) => n.toUpperCase()));

/** SQL keywords (case-insensitive). */
const CM_KEYWORDS = new Set(SQL_KEYWORDS.map((k) => k.toUpperCase()));

/**
 * Tokenizer state for the CosmosDB NoSQL stream parser.
 */
interface NoSqlTokenState {
    /** Current context: 'top' | 'blockComment' | 'singleString' | 'quotedIdentifier' */
    context: string;
}

/**
 * A CodeMirror 6 `StreamParser` for CosmosDB NoSQL query syntax.
 *
 * Highlights keywords, built-in functions, word-based operators,
 * strings, numbers, comments, and identifiers. Compatible with
 * `StreamLanguage.define()`.
 *
 * @example
 * ```typescript
 * import { StreamLanguage } from "@codemirror/language";
 * import { cosmosDbSqlStreamParser } from "@cosmosdb/nosql-language-service/codemirror";
 *
 * const lang = StreamLanguage.define(cosmosDbSqlStreamParser);
 * // Pass `lang` as an extension to EditorState.create({ extensions: [lang] })
 * ```
 */
export const cosmosDbSqlStreamParser: StreamParser<NoSqlTokenState> = {
    name: 'cosmosdb-sql',

    startState(): NoSqlTokenState {
        return { context: 'top' };
    },

    token(stream: StringStream, state: NoSqlTokenState): string | null {
        // --- Block comment continuation ---
        if (state.context === 'blockComment') {
            while (!stream.eol()) {
                if (stream.match('*/')) {
                    state.context = 'top';
                    return 'blockComment';
                }
                stream.next();
            }
            return 'blockComment';
        }

        // --- Single-quoted string continuation ---
        if (state.context === 'singleString') {
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next(); // skip escaped char
                } else if (ch === "'") {
                    // Check for SQL-style escaped quote ''
                    if (stream.peek() === "'") {
                        stream.next();
                    } else {
                        state.context = 'top';
                        return 'string';
                    }
                }
            }
            return 'string';
        }

        // --- Quoted identifier continuation ---
        if (state.context === 'quotedIdentifier') {
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === '"') {
                    state.context = 'top';
                    return 'string.special';
                }
            }
            return 'string.special';
        }

        // --- Top-level tokenization ---

        // Skip whitespace
        if (stream.eatSpace()) return null;

        // Line comment: --
        if (stream.match('--')) {
            stream.skipToEnd();
            return 'lineComment';
        }

        // Block comment start: /*
        if (stream.match('/*')) {
            state.context = 'blockComment';
            // Check if it closes on the same match
            while (!stream.eol()) {
                if (stream.match('*/')) {
                    state.context = 'top';
                    return 'blockComment';
                }
                stream.next();
            }
            return 'blockComment';
        }

        // Single-quoted string
        if (stream.peek() === "'") {
            stream.next();
            state.context = 'singleString';
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === "'") {
                    if (stream.peek() === "'") {
                        stream.next();
                    } else {
                        state.context = 'top';
                        return 'string';
                    }
                }
            }
            return 'string';
        }

        // Double-quoted identifier
        if (stream.peek() === '"') {
            stream.next();
            state.context = 'quotedIdentifier';
            while (!stream.eol()) {
                const ch = stream.next();
                if (ch === '\\') {
                    stream.next();
                } else if (ch === '"') {
                    state.context = 'top';
                    return 'string.special';
                }
            }
            return 'string.special';
        }

        // Numbers: hex, float, integer
        if (stream.match(/^0[xX][0-9a-fA-F]+/) || stream.match(/^\d+\.\d*(?:[eE][-+]?\d+)?/) || stream.match(/^\d+[eE][-+]?\d+/) || stream.match(/^\d+/)) {
            return 'number';
        }

        // Multi-char operators
        if (stream.match(/^(?:>>>|>>|<<|\|\||[<>]=?|!=|<>|\?\?)/) || stream.match(/^[+\-*/%&|^~]/)) {
            return 'operator';
        }

        // Brackets and delimiters
        if (stream.match(/^[()[\]]/)) {
            return 'paren';
        }
        if (stream.match(/^[,;.]/)) {
            return 'punctuation';
        }

        // Words: keywords, operators, functions, identifiers
        if (stream.match(/^[a-zA-Z_]\w*/)) {
            const word = stream.current().toUpperCase();
            if (CM_OPERATORS.has(word)) return 'operatorKeyword';
            if (CM_KEYWORDS.has(word)) return 'keyword';
            if (CM_BUILTINS.has(word)) return 'function(definition)';
            return 'variableName';
        }

        // Fallback: consume one character
        stream.next();
        return null;
    },
};

// ========================== Kind mappers ======================================

function mapCompletionKind(kind: string): string {
    switch (kind) {
        case 'keyword':
            return 'keyword';
        case 'field':
            return 'property';
        case 'function':
            return 'function';
        case 'snippet':
            return 'text';
        case 'alias':
            return 'variable';
        case 'parameter':
            return 'variable';
        default:
            return 'text';
    }
}

function mapSeverity(severity: DsSeverity): Diagnostic['severity'] {
    switch (severity) {
        case DsSeverity.Error:
            return 'error';
        case DsSeverity.Warning:
            return 'warning';
        case DsSeverity.Information:
            return 'info';
        case DsSeverity.Hint:
            return 'info';
        default:
            return 'error';
    }
}
