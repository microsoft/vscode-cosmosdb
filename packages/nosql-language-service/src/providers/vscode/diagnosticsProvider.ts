/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type Disposable } from '../../services/types.js';
import { LANGUAGE_ID } from '../shared.js';
import { mapSeverity, type TimerId, type VSCodeDiagnosticsProviderOptions, type VSCodeNamespace } from './types.js';

export class VSCodeDiagnosticsProvider implements Disposable {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;
    private readonly languageId: string;
    private readonly diagnosticDelay: number;
    private readonly collection: vscodeApi.DiagnosticCollection;
    private readonly disposables: Disposable[] = [];
    private readonly timers = new Map<string, TimerId>();

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService, options: VSCodeDiagnosticsProviderOptions = {}) {
        this.vscode = vscode;
        this.service = service;
        this.languageId = options.languageId ?? LANGUAGE_ID;
        this.diagnosticDelay = options.diagnosticDelay ?? 300;
        this.collection = this.vscode.languages.createDiagnosticCollection(options.collectionName ?? 'cosmosdb-sql');

        this.disposables.push(this.collection);
        this.disposables.push(
            this.vscode.workspace.onDidChangeTextDocument((event: vscodeApi.TextDocumentChangeEvent) => {
                this.scheduleDiagnostics(event.document);
            }),
        );
        this.disposables.push(
            this.vscode.workspace.onDidOpenTextDocument((document: vscodeApi.TextDocument) => {
                this.pushDiagnostics(document);
            }),
        );
        this.disposables.push(
            this.vscode.workspace.onDidCloseTextDocument((document: vscodeApi.TextDocument) => {
                this.clearDiagnostics(document);
            }),
        );

        for (const document of this.vscode.workspace.textDocuments) {
            this.pushDiagnostics(document);
        }
    }

    dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private scheduleDiagnostics(document: vscodeApi.TextDocument): void {
        if (document.languageId !== this.languageId) return;
        const key = String(document.uri);
        const existing = this.timers.get(key);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.timers.delete(key);
            this.pushDiagnostics(document);
        }, this.diagnosticDelay);
        this.timers.set(key, timer);
    }

    private clearDiagnostics(document: vscodeApi.TextDocument): void {
        const key = String(document.uri);
        const timer = this.timers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
        this.collection.delete(document.uri);
    }

    private pushDiagnostics(document: vscodeApi.TextDocument): void {
        if (document.languageId !== this.languageId) return;
        const query = document.getText();
        const diags = this.service.getDiagnostics(query);
        this.collection.set(
            document.uri,
            diags.map((d) => {
                const range = new this.vscode.Range(
                    new this.vscode.Position(d.range.startLine - 1, d.range.startColumn - 1),
                    new this.vscode.Position(d.range.endLine - 1, d.range.endColumn - 1),
                );
                const diagnostic = new this.vscode.Diagnostic(range, d.message, mapSeverity(this.vscode, d.severity));
                diagnostic.code = d.code;
                diagnostic.source = d.source ?? 'cosmosdb-sql';
                return diagnostic;
            }),
        );
    }
}

