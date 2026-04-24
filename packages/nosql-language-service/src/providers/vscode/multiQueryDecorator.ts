/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { type TimerId, type VSCodeNamespace } from './types.js';

export class VSCodeMultiQueryDecorator implements Disposable {
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly delay: number;
    private readonly disposables: Disposable[] = [];
    private readonly separatorDecorationType: vscodeApi.TextEditorDecorationType;
    private timer: TimerId | undefined;

    constructor(
        vscode: VSCodeNamespace,
        service: SqlLanguageService,
        options: { languageId?: string; decorationDelay?: number } = {},
    ) {
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.delay = options.decorationDelay ?? 300;

        this.separatorDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderWidth: '0 0 2px 0',
            borderStyle: 'solid',
            borderColor:
                'var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060))',
            after: {
                contentText: '',
                margin: '0 0 1em 0',
            },
        });

        const updateIfMatches = (editor: vscodeApi.TextEditor | undefined) => {
            if (editor && editor.document.languageId === this.languageId) {
                this.updateDecorations(editor);
            }
        };

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = undefined;
                }
                updateIfMatches(editor);
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document !== event.document) return;
                if (editor.document.languageId !== this.languageId) return;
                this.scheduleUpdate(editor);
            }),
        );

        updateIfMatches(vscode.window.activeTextEditor);
    }

    private scheduleUpdate(editor: vscodeApi.TextEditor): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.updateDecorations(editor);
        }, this.delay);
    }

    private updateDecorations(editor: vscodeApi.TextEditor): void {
        const text = editor.document.getText();
        const separators = this.service.getSeparatorPositions(text);
        const ranges: vscodeApi.DecorationOptions[] = separators.map((sep) => {
            const pos = editor.document.positionAt(sep.semicolonOffset);
            const line = editor.document.lineAt(pos.line);
            return { range: line.range };
        });
        editor.setDecorations(this.separatorDecorationType, ranges);
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.separatorDecorationType.dispose();
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }
}

