/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorView, type Tooltip, type TooltipView } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';
import { createTooltipView, escapeHtml } from './types.js';

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
                let html = `<div class="cm-cosmosdb-sig-label">`;
                const params = sig.parameters;
                const activeIdx = result.activeParameter;

                if (params.length > 0) {
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

                const activeParam = params[activeIdx];
                if (activeParam?.documentation) {
                    html += `<div class="cm-cosmosdb-sig-doc">${escapeHtml(activeParam.documentation)}</div>`;
                } else if (sig.documentation) {
                    html += `<div class="cm-cosmosdb-sig-doc">${escapeHtml(sig.documentation)}</div>`;
                }

                return createTooltipView(_view, 'cm-cosmosdb-signature-help', html);
            },
        };
    };
}
