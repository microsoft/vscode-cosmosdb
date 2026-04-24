/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';
import { type MonacoNamespace } from './types.js';

/**
 * Standalone hover provider for Monaco Editor.
 */
export class MonacoHoverProvider implements monacoEditor.languages.HoverProvider {
    private readonly service: SqlLanguageService;

    constructor(_monaco: MonacoNamespace, service: SqlLanguageService) {
        this.service = service;
    }

    provideHover(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.Hover | null {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const info = this.service.getHoverInfo(query, offset);
        if (!info) return null;

        return {
            contents: info.contents.map((c) => ({
                value: c,
                isTrusted: true,
            })),
            range: info.range
                ? {
                      startLineNumber: info.range.startLine,
                      startColumn: info.range.startColumn,
                      endLineNumber: info.range.endLine,
                      endColumn: info.range.endColumn,
                  }
                : undefined,
        };
    }
}

