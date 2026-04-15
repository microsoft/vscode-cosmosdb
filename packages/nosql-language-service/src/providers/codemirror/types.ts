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
 * Helper to create a DOM element from a CodeMirror EditorView.
 * Works around the lack of DOM types in this package's TS config.
 */
export function createDomElement(
    view: EditorView,
    className: string,
    innerHTML: string,
): TooltipView['dom'] {
    const viewDom = view.dom as unknown as Record<string, unknown>;
    const ownerDoc = viewDom['ownerDocument'] as { createElement(tag: string): Record<string, unknown> };
    const dom = ownerDoc.createElement('div');
    dom['className'] = className;
    dom['innerHTML'] = innerHTML;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return dom as unknown as TooltipView['dom'];
}

