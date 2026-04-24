/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorView, type Tooltip, type TooltipView } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';
import { createTooltipView, escapeHtml } from './types.js';

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
                return createTooltipView(
                    _view,
                    'cm-cosmosdb-hover',
                    info.contents.map((c: string) => `<div>${escapeHtml(c)}</div>`).join(''),
                );
            },
        };
    };
}
