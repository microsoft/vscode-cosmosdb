/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';

/**
 * Standalone document formatting provider for Monaco Editor.
 */
export class MonacoFormattingProvider implements monacoEditor.languages.DocumentFormattingEditProvider {
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideDocumentFormattingEdits(model: monacoEditor.editor.ITextModel): monacoEditor.languages.TextEdit[] {
        const query = model.getValue();
        const edits = this.service.getFormatEdits(query);
        return edits.map((e) => ({
            range: {
                startLineNumber: e.range.startLine,
                startColumn: e.range.startColumn,
                endLineNumber: e.range.endLine,
                endColumn: e.range.endColumn,
            },
            text: e.newText,
        }));
    }
}

