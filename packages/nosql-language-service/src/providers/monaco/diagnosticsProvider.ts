/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { mapSeverity, type TimerId, type MonacoDiagnosticsProviderOptions, type MonacoNamespace } from './types.js';

/**
 * Standalone diagnostics controller for Monaco Editor.
 *
 * Monaco diagnostics are pushed via `editor.setModelMarkers()` rather than a
 * `languages.register*Provider()` API, so this class manages model listeners
 * and marker updates for a language.
 */
export class MonacoDiagnosticsProvider implements Disposable {
    private readonly monaco: MonacoNamespace;
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly owner: string;
    private readonly diagnosticDelay: number;
    private readonly timers = new Map<monacoEditor.editor.ITextModel, TimerId>();
    private readonly modelDisposables = new Map<monacoEditor.editor.ITextModel, Disposable[]>();
    private readonly rootDisposables: Disposable[] = [];

    constructor(monaco: MonacoNamespace, service: SqlLanguageService, options: MonacoDiagnosticsProviderOptions = {}) {
        this.monaco = monaco;
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.owner = options.owner ?? 'cosmosdb-sql';
        this.diagnosticDelay = options.diagnosticDelay ?? 300;

        this.rootDisposables.push(
            this.monaco.editor.onDidCreateModel((model: monacoEditor.editor.ITextModel) => {
                this.observeModel(model);
            }),
        );

        if (typeof this.monaco.editor.onDidChangeModelLanguage === 'function') {
            this.rootDisposables.push(
                this.monaco.editor.onDidChangeModelLanguage(
                    (event: { model: monacoEditor.editor.ITextModel; oldLanguage: string }) => {
                        this.unobserveModel(event.model);
                        this.observeModel(event.model);
                    },
                ),
            );
        }

        for (const model of this.monaco.editor.getModels()) {
            this.observeModel(model);
        }
    }

    dispose(): void {
        for (const model of Array.from(this.modelDisposables.keys())) {
            this.unobserveModel(model);
        }

        for (const disposable of this.rootDisposables) {
            disposable.dispose();
        }
        this.rootDisposables.length = 0;
    }

    private observeModel(model: monacoEditor.editor.ITextModel): void {
        if (model.getLanguageId() !== this.languageId) return;
        if (this.modelDisposables.has(model)) return;

        this.pushDiagnostics(model);

        const disposables: Disposable[] = [];
        disposables.push(
            model.onDidChangeContent(() => {
                this.scheduleDiagnostics(model);
            }),
        );
        disposables.push(
            model.onWillDispose(() => {
                this.unobserveModel(model);
            }),
        );

        this.modelDisposables.set(model, disposables);
    }

    private unobserveModel(model: monacoEditor.editor.ITextModel): void {
        const disposables = this.modelDisposables.get(model);
        if (disposables) {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            this.modelDisposables.delete(model);
        }

        const timer = this.timers.get(model);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(model);
        }

        if (typeof model.getLanguageId === 'function' && model.getLanguageId() === this.languageId) {
            this.monaco.editor.setModelMarkers(model, this.owner, []);
        }
    }

    private scheduleDiagnostics(model: monacoEditor.editor.ITextModel): void {
        const existing = this.timers.get(model);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.timers.delete(model);
            this.pushDiagnostics(model);
        }, this.diagnosticDelay);

        this.timers.set(model, timer);
    }

    private pushDiagnostics(model: monacoEditor.editor.ITextModel): void {
        const query = model.getValue();
        const diags = this.service.getDiagnostics(query);
        const markers = diags.map((d) => ({
            severity: mapSeverity(this.monaco, d.severity),
            message: d.message,
            startLineNumber: d.range.startLine,
            startColumn: d.range.startColumn,
            endLineNumber: d.range.endLine,
            endColumn: d.range.endColumn,
            code: d.code,
            source: d.source,
        }));
        this.monaco.editor.setModelMarkers(model, this.owner, markers);
    }
}

