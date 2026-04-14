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
import { type Diagnostic } from '@codemirror/lint';
import { type EditorView, type Tooltip, type TooltipView } from '@codemirror/view';
import { type SqlLanguageService } from '../services/index.js';
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
