/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Diagnostic } from '@codemirror/lint';
import { type EditorView, type TooltipView } from '@codemirror/view';
import { DiagnosticSeverity as DsSeverity } from '../../services/types.js';

/**
 * Suggested options shape for a CodeMirror host that wraps the language
 * service's individual extension factories behind a single config object.
 *
 * Unlike the Monaco/VS Code adapters, the CodeMirror surface is a set of
 * standalone factories the host composes manually — nothing in this package
 * consumes `CodeMirrorOptions` directly. It exists so different hosts can
 * agree on the same option names when they expose a single config knob.
 */
export interface CodeMirrorOptions {
    /**
     * Compose the autocomplete source (`createCompletionSource(service)`).
     * Disable if your host already provides completions for this language.
     * @default true
     */
    completions?: boolean;
    /**
     * Compose the lint source (`createLintSource(service)`).
     * Disable for read-only viewers where you don't want squiggles.
     * @default true
     */
    diagnostics?: boolean;
    /**
     * Compose the hover tooltip source (`createHoverTooltipSource(service)`).
     * @default true
     */
    hover?: boolean;
}

/**
 * CodeMirror modules the multi-query separator extension needs to draw
 * its line decorations. Injected by the host so this package can stay
 * free of a hard `@codemirror/view` dependency at module load time.
 */
export interface MultiQuerySeparatorDeps {
    ViewPlugin: {
        fromClass<V extends object>(
            cls: new (view: EditorView) => V,
            spec?: { decorations?: (value: V) => unknown },
        ): unknown;
    };
    Decoration: {
        line(spec: { class: string }): { range(from: number): unknown };
        none: unknown;
        set(of: unknown[], sort?: boolean): unknown;
    };
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mapCompletionKind(kind: string): string {
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

export function mapSeverity(severity: DsSeverity): Diagnostic['severity'] {
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

/**
 * Helper to create a TooltipView from a CodeMirror EditorView.
 * Contains all DOM-related unsafe code so callers stay lint-clean.
 */
export function createTooltipView(view: EditorView, className: string, innerHTML: string): TooltipView {
    const ownerDoc = view.dom.ownerDocument;
    const dom = ownerDoc.createElement('div');
    dom.className = className;
    dom.innerHTML = innerHTML;
    return { dom } as TooltipView;
}
