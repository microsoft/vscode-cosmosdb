/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';

/**
 * Provides folding ranges for multi-query documents.
 */
export class MonacoFoldingRangeProvider implements monacoEditor.languages.FoldingRangeProvider {
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideFoldingRanges(model: monacoEditor.editor.ITextModel): monacoEditor.languages.FoldingRange[] {
        const text = model.getValue();
        const foldable = this.service.getFoldableRegions(text);

        const ranges: monacoEditor.languages.FoldingRange[] = [];
        for (const region of foldable) {
            const startPos = model.getPositionAt(region.contentStartOffset);
            const endPos = model.getPositionAt(region.contentEndOffset);
            if (endPos.lineNumber > startPos.lineNumber) {
                ranges.push({
                    start: startPos.lineNumber,
                    end: endPos.lineNumber,
                });
            }
        }
        return ranges;
    }
}

