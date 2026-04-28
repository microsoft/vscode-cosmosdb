/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorView, type ViewUpdate } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';
import { type MultiQuerySeparatorDeps } from './types.js';

const SEPARATOR_CLASS = 'cosmosdb-query-separator';

function ensureSeparatorStyles(): void {
     
    const g = globalThis as any;
    if (!g?.document?.createElement) return;
    const STYLE_ID = 'cosmosdb-multiquery-styles';
    if (g.document.getElementById(STYLE_ID)) return;
    const style = g.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        `.${SEPARATOR_CLASS} {`,
        `  border-bottom: 2px solid var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060));`,
        `  padding-bottom: 1em;`,
        `}`,
    ].join('\n');
    g.document.head.appendChild(style);
     
}

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

