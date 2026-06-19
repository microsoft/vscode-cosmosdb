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
const ACTIVE_BLOCK_CLASS = 'cosmosdb-active-query-block';

const STYLE_ID = 'cosmosdb-multiquery-styles';

// Width and inner offset (from the left of the lines-decorations sub-region)
// of the active-query bar in pixels. Both gaps are derived from these and
// from `--cosmosdb-deco-width` set at runtime from `EditorLayoutInfo`.
const BAR_LEFT_GAP_PX = 4;
const BAR_WIDTH_PX = 3;
const BAR_RIGHT_GAP_PX = 4;
// Total gutter width needed to host the bar with gaps on both sides.
// Applied via `editor.updateOptions` on attach so hosts don't need to mirror it.
const LINE_DECORATIONS_WIDTH_PX = BAR_LEFT_GAP_PX + BAR_WIDTH_PX + BAR_RIGHT_GAP_PX;

function ensureSeparatorStyles(): void {
    if (typeof document === 'undefined') return;
    // Always rebuild the stylesheet so that updates to these rules (e.g.
    // when the source is edited during development) take effect on reload.
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // Active-block bar rendering notes:
    //
    // Monaco renders each `linesDecorationsClassName` decoration as a `.cdr`
    // element inside `.margin-view-overlays`. The inline `left` / `width`
    // Monaco sets are positions WITHIN the entire margin (line numbers +
    // glyph margin + lines-decorations), measured from the editor's left
    // edge. Painting a `linear-gradient` background with absolute pixel
    // stops on a `.cdr` that spans the full margin width therefore lands
    // somewhere over the line numbers — NOT in the lines-decorations
    // gutter, which is what the user actually sees as "the gutter".
    //
    // To draw the bar predictably we:
    //   1. Read `EditorLayoutInfo.decorationsLeft` / `decorationsWidth` from
    //      Monaco and publish them on the editor container as the CSS
    //      custom properties `--cosmosdb-deco-left` / `--cosmosdb-deco-width`.
    //   2. Override Monaco's inline `left` / `width` on the active-block
    //      `.cdr` so the element exactly covers the lines-decorations
    //      sub-region (and only that — not the line numbers, not the
    //      glyph margin).
    //   3. Paint the bar via a `linear-gradient` whose stops are now
    //      relative to the lines-decorations sub-region, giving a visible
    //      gap on BOTH sides of the bar.
    style.textContent = [
        `.${SEPARATOR_CLASS} {`,
        `  border-bottom: 2px solid var(--vscode-editorIndentGuide-activeBackground, var(--vscode-editorIndentGuide-background, #606060));`,
        `}`,
        `.${ACTIVE_BLOCK_CLASS} {`,
        `  left: var(--cosmosdb-deco-left, 0px) !important;`,
        `  width: var(--cosmosdb-deco-width, 16px) !important;`,
        `  background: linear-gradient(`,
        `      to right,`,
        `      transparent 0,`,
        `      transparent ${BAR_LEFT_GAP_PX}px,`,
        `      var(--vscode-focusBorder, #007fd4) ${BAR_LEFT_GAP_PX}px,`,
        `      var(--vscode-focusBorder, #007fd4) ${BAR_LEFT_GAP_PX + BAR_WIDTH_PX}px,`,
        `      transparent ${BAR_LEFT_GAP_PX + BAR_WIDTH_PX}px`,
        `  ) no-repeat;`,
        `  pointer-events: none;`,
        `}`,
    ].join('\n');
    document.head.appendChild(style);
}

/**
 * Manages visual decorations for multi-query documents in Monaco:
 * separator lines and view-zone spacing between query regions.
 */
export class MonacoMultiQueryDecorator implements Disposable {
    private readonly service: SqlLanguageService;
    private readonly disposables: Disposable[] = [];
    private decorations: monacoEditor.editor.IEditorDecorationsCollection | null = null;
    private activeBlockDecorations: monacoEditor.editor.IEditorDecorationsCollection | null = null;
    private editor: monacoEditor.editor.IStandaloneCodeEditor | null = null;
    private viewZoneIds: string[] = [];
    private readonly highlightActiveBlock: boolean;

    constructor(
        monaco: MonacoNamespace,
        service: SqlLanguageService,
        options: {
            languageId?: string;
            decorationDelay?: number;
            highlightActiveBlock?: boolean;
        } = {},
    ) {
        this.service = service;
        this.highlightActiveBlock = options.highlightActiveBlock ?? true;
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
            this.activeBlockDecorations = codeEditor.createDecorationsCollection();

            // Reserve gutter width for the active-query bar.
            if (typeof codeEditor.updateOptions === 'function') {
                codeEditor.updateOptions({ lineDecorationsWidth: LINE_DECORATIONS_WIDTH_PX });
            }

            // Publish the lines-decorations sub-region geometry as CSS custom
            // properties on the editor container so the active-block bar can
            // position itself exactly inside that sub-region (and not over
            // the line numbers or the glyph margin). See `ensureSeparatorStyles`.
            const publishLayoutVars = () => {
                if (typeof codeEditor.getContainerDomNode !== 'function') return;
                const container = codeEditor.getContainerDomNode();
                if (!container) return;
                const layout = codeEditor.getLayoutInfo();
                container.style.setProperty('--cosmosdb-deco-left', `${layout.decorationsLeft}px`);
                container.style.setProperty('--cosmosdb-deco-width', `${layout.decorationsWidth}px`);
            };
            publishLayoutVars();
            if (typeof codeEditor.onDidLayoutChange === 'function') {
                this.disposables.push(codeEditor.onDidLayoutChange(() => publishLayoutVars()));
            }

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

            if (this.highlightActiveBlock) {
                this.disposables.push(
                    codeEditor.onDidChangeCursorPosition((e) => {
                        const m = codeEditor.getModel();
                        if (!m) return;
                        const offset = m.getOffsetAt(e.position);
                        this.updateActiveBlockDecoration(m, offset);
                    }),
                );
                // Apply initial highlight at current cursor position
                const pos = codeEditor.getPosition();
                if (pos) {
                    const offset = model.getOffsetAt(pos);
                    this.updateActiveBlockDecoration(model, offset);
                }
            }
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

    private updateActiveBlockDecoration(model: monacoEditor.editor.ITextModel, cursorOffset: number): void {
        if (!this.activeBlockDecorations) return;

        const text = model.getValue();
        const block = this.service.getActiveBlockOffsets(text, cursorOffset);
        if (!block) {
            this.activeBlockDecorations.clear();
            return;
        }

        const startPos = model.getPositionAt(block.startOffset);
        const endPos = model.getPositionAt(block.endOffset - 1);

        this.activeBlockDecorations.set([
            {
                range: {
                    startLineNumber: startPos.lineNumber,
                    startColumn: 1,
                    endLineNumber: endPos.lineNumber,
                    endColumn: model.getLineMaxColumn(endPos.lineNumber),
                },
                options: {
                    isWholeLine: true,
                    linesDecorationsClassName: ACTIVE_BLOCK_CLASS,
                    stickiness: 0,
                },
            },
        ]);
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
                        if (typeof document === 'undefined') return null as unknown as HTMLElement;
                        const node = document.createElement('div');
                        node.style.pointerEvents = 'none';
                        return node;
                    })(),
                });
                this.viewZoneIds.push(id);
            }
        });
    }

    dispose(): void {
        this.decorations?.clear();
        this.decorations = null;
        this.activeBlockDecorations?.clear();
        this.activeBlockDecorations = null;
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
