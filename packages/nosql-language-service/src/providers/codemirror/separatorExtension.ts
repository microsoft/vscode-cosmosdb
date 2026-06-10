/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorView, type ViewUpdate } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';
import { type MultiQuerySeparatorDeps } from './types.js';

const SEPARATOR_CLASS = 'cosmosdb-query-separator';

function ensureSeparatorStyles(): void {
    if (typeof document === 'undefined') return;
    const STYLE_ID = 'cosmosdb-multiquery-styles';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        `.${SEPARATOR_CLASS} {`,
        `  border-bottom: 2px solid var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060));`,
        `  padding-bottom: 1em;`,
        `}`,
    ].join('\n');
    document.head.appendChild(style);
}

/**
 * Build a CodeMirror `ViewPlugin` extension that draws a separator line
 * under each semicolon in a multi-query document.
 *
 * Styles are hardcoded and injected into the document head under the
 * `cosmosdb-query-separator` class — symmetric with the Monaco and VS Code
 * multi-query decorators, which also don't expose styling knobs.
 *
 * @param service - The language service used to find `;` positions.
 * @param deps - CodeMirror modules the extension needs (see {@link MultiQuerySeparatorDeps}).
 */
export function createMultiQuerySeparatorExtension(
    service: SqlLanguageService,
    deps: MultiQuerySeparatorDeps,
): unknown {
    ensureSeparatorStyles();

    const lineDeco = deps.Decoration.line({ class: SEPARATOR_CLASS });

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

    type Doc = { toString(): string; lineAt(pos: number): { from: number } };

    class SeparatorPlugin {
        decorations: unknown;

        constructor(view: EditorView) {
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
