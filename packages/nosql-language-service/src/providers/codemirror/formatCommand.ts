/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EditorView } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';

export function createFormatCommand(service: SqlLanguageService): (view: EditorView) => boolean {
    return (view: EditorView) => {
        const query: string = view.state.doc.toString();
        const edits = service.getFormatEdits(query);
        if (edits.length === 0) return false;

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

