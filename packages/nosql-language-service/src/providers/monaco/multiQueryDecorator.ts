/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { type MonacoNamespace } from './types.js';

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
        `}`,
    ].join('\n');
    g.document.head.appendChild(style);
     
}

/**
 * Manages visual decorations for multi-query documents in Monaco:
 * separator lines and view-zone spacing between query regions.
 */
export class MonacoMultiQueryDecorator implements Disposable {
    private readonly service: SqlLanguageService;
    private readonly disposables: Disposable[] = [];
    private decorations: monacoEditor.editor.IEditorDecorationsCollection | null = null;
    private editor: monacoEditor.editor.IStandaloneCodeEditor | null = null;
    private viewZoneIds: string[] = [];

    constructor(
        monaco: MonacoNamespace,
        service: SqlLanguageService,
        options: { languageId?: string; decorationDelay?: number; separatorSpacing?: number } = {},
    ) {
        this.service = service;
        const languageId = options.languageId ?? LANGUAGE_ID;
        const delay = options.decorationDelay ?? 300;

        ensureSeparatorStyles();

        const attachToEditor = (editor: monacoEditor.editor.ICodeEditor) => {
            if (this.editor) return;
            const codeEditor = editor as monacoEditor.editor.IStandaloneCodeEditor;
            if (typeof codeEditor.getModel !== 'function') return;
            const model = codeEditor.getModel();
            if (!model || model.getLanguageId() !== languageId) return;

            this.editor = codeEditor;
            this.decorations = codeEditor.createDecorationsCollection();
            this.updateDecorations();

            let timer: ReturnType<typeof setTimeout> | undefined;
            const scheduleUpdate = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = undefined;
                    this.updateDecorations();
                }, delay);
            };

            this.disposables.push(model.onDidChangeContent(() => scheduleUpdate()));
        };

        const tryAttachAll = () => {
            if (this.editor) return;
            if (typeof monaco.editor.getEditors === 'function') {
                for (const existing of monaco.editor.getEditors()) {
                    attachToEditor(existing);
                }
            }
        };

        this.disposables.push(
            monaco.editor.onDidCreateEditor((editor) => {
                attachToEditor(editor);
                if (!this.editor) {
                    setTimeout(() => attachToEditor(editor), 100);
                }
            }),
        );

        this.disposables.push(monaco.editor.onDidCreateModel(() => tryAttachAll()));
        if (typeof monaco.editor.onDidChangeModelLanguage === 'function') {
            this.disposables.push(monaco.editor.onDidChangeModelLanguage(() => tryAttachAll()));
        }

        tryAttachAll();
    }

    private updateDecorations(): void {
        const editor = this.editor;
        if (!editor || !this.decorations) return;
        const model = editor.getModel();
        if (!model) return;

        const text = model.getValue();
        const separators = this.service.getSeparatorPositions(text);

        const newDecorations: monacoEditor.editor.IModelDeltaDecoration[] = [];
        const separatorLineNumbers: number[] = [];

        for (const sep of separators) {
            const endPos = model.getPositionAt(sep.semicolonOffset);
            separatorLineNumbers.push(endPos.lineNumber);
            newDecorations.push({
                range: {
                    startLineNumber: endPos.lineNumber,
                    startColumn: 1,
                    endLineNumber: endPos.lineNumber,
                    endColumn: model.getLineMaxColumn(endPos.lineNumber),
                },
                options: {
                    isWholeLine: true,
                    className: SEPARATOR_CLASS,
                    stickiness: 1,
                },
            });
        }

        this.decorations.set(newDecorations);

        editor.changeViewZones((accessor) => {
            for (const id of this.viewZoneIds) {
                accessor.removeZone(id);
            }
            this.viewZoneIds = [];

            for (const lineNumber of separatorLineNumbers) {
                const id = accessor.addZone({
                    afterLineNumber: lineNumber,
                    heightInLines: 1,
                     
                    domNode: (() => {
                        const g = globalThis as any;
                        const node = g?.document?.createElement?.('div');
                        if (node) {
                            node.style.pointerEvents = 'none';
                        }
                        return node ?? g?.document?.createElement?.('div');
                    })(),
                     
                });
                this.viewZoneIds.push(id);
            }
        });
    }

    dispose(): void {
        this.decorations?.clear();
        this.decorations = null;
        if (this.editor && this.viewZoneIds.length > 0) {
            const ids = this.viewZoneIds;
            this.editor.changeViewZones((accessor) => {
                for (const id of ids) {
                    accessor.removeZone(id);
                }
            });
        }
        this.viewZoneIds = [];
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
    }
}

