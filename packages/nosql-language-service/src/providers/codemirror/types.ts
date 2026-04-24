/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Diagnostic } from '@codemirror/lint';
import { type EditorView, type TooltipView } from '@codemirror/view';
import { DiagnosticSeverity as DsSeverity } from '../../services/types.js';

export interface CodeMirrorOptions {
    /** @default true */
    completions?: boolean;
    /** @default true */
    diagnostics?: boolean;
    /** @default true */
    hover?: boolean;
}

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
     
    const ownerDoc = (view.dom as any).ownerDocument;
    const dom = ownerDoc.createElement('div');
    dom.className = className;
    dom.innerHTML = innerHTML;
    return { dom } as TooltipView;
}
