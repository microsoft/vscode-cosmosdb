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
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly delay: number;
    private readonly highlightActiveBlock: boolean;
    private readonly disposables: Disposable[] = [];
    private readonly separatorDecorationType: vscodeApi.TextEditorDecorationType;
    private readonly activeBlockDecorationType: vscodeApi.TextEditorDecorationType;
    private timer: TimerId | undefined;

    constructor(
        vscode: VSCodeNamespace,
        service: SqlLanguageService,
        options: { languageId?: string; decorationDelay?: number; highlightActiveBlock?: boolean } = {},
    ) {
        this.vscode = vscode;
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.delay = options.decorationDelay ?? 300;
        this.highlightActiveBlock = options.highlightActiveBlock ?? true;

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

        this.activeBlockDecorationType = vscode.window.createTextEditorDecorationType({
            // `before` pseudo-element with a fixed `width` reserves a stable
            // 3px slot before each line's text. The bar color is set
            // per-instance (see `updateActiveBlockDecoration`) so non-active
            // lines keep the reserved space without painting a visible bar —
            // text never shifts when the active block moves.
            before: {
                contentText: '\u00A0',
                color: 'transparent',
                width: '3px',
                margin: '0 4px 0 0',
            },
        });

        const updateIfMatches = (editor: vscodeApi.TextEditor | undefined) => {
            if (editor && editor.document.languageId === this.languageId) {
                this.updateDecorations(editor);
                if (this.highlightActiveBlock) {
                    this.updateActiveBlockDecoration(editor);
                }
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

        if (this.highlightActiveBlock) {
            this.disposables.push(
                vscode.window.onDidChangeTextEditorSelection((event) => {
                    const editor = event.textEditor;
                    if (editor.document.languageId !== this.languageId) return;
                    this.updateActiveBlockDecoration(editor);
                }),
            );
        }

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

    private updateActiveBlockDecoration(editor: vscodeApi.TextEditor): void {
        const text = editor.document.getText();
        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const block = this.service.getActiveBlockOffsets(text, cursorOffset);

        // No active block to highlight (single-query doc, cursor outside any
        // region, or whitespace-only region) — clear the reserved gutter slot.
        if (!block) {
            editor.setDecorations(this.activeBlockDecorationType, []);
            return;
        }

        const activeStartLine = editor.document.positionAt(block.startOffset).line;
        const activeEndLine = editor.document.positionAt(block.endOffset - 1).line;

        // Decorate every line to keep the reserved slot stable; only active
        // lines override `backgroundColor` to paint the visible bar.
        const activeColor = 'var(--vscode-focusBorder, #007fd4)';
        const totalLines = editor.document.lineCount;
        const decorations: vscodeApi.DecorationOptions[] = [];
        for (let line = 0; line < totalLines; line++) {
            const range = new this.vscode.Range(line, 0, line, 0);
            if (line >= activeStartLine && line <= activeEndLine) {
                decorations.push({
                    range,
                    renderOptions: { before: { backgroundColor: activeColor } },
                });
            } else {
                decorations.push({ range });
            }
        }

        editor.setDecorations(this.activeBlockDecorationType, decorations);
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.separatorDecorationType.dispose();
        this.activeBlockDecorationType.dispose();
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }
}
