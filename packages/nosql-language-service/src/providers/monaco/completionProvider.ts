/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';
import { mapCompletionKind, type MonacoNamespace } from './types.js';

/**
 * Standalone completion item provider for Monaco Editor.
 */
export class MonacoCompletionProvider implements monacoEditor.languages.CompletionItemProvider {
    readonly triggerCharacters = ['.', ' ', ','];
    private readonly monaco: MonacoNamespace;
    private readonly service: SqlLanguageService;

    constructor(monaco: MonacoNamespace, service: SqlLanguageService) {
        this.monaco = monaco;
        this.service = service;
    }

    provideCompletionItems(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.CompletionList {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const items = this.service.getCompletions(query, offset);

        const wordInfo = model.getWordUntilPosition(position);
        const range: monacoEditor.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: wordInfo.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: wordInfo.endColumn,
        };

        return {
            suggestions: items.map((item) => ({
                label: item.label,
                kind: mapCompletionKind(this.monaco, item.kind),
                detail: item.detail,
                insertText: item.insertText ?? item.label,
                insertTextRules: item.insertText?.includes('$0')
                    ? this.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                    : undefined,
                sortText: item.sortText,
                range,
            })),
        };
    }
}

