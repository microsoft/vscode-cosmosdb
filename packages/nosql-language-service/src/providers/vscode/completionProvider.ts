/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { mapCompletionKind, type VSCodeNamespace } from './types.js';

export class VSCodeCompletionProvider implements vscodeApi.CompletionItemProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideCompletionItems(document: vscodeApi.TextDocument, position: vscodeApi.Position): vscodeApi.CompletionItem[] {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const items = this.service.getCompletions(query, offset);

        return items.map((item) => {
            const ci = new this.vscode.CompletionItem(item.label, mapCompletionKind(this.vscode, item.kind));
            ci.detail = item.detail;
            ci.sortText = item.sortText;
            if (item.insertText) {
                ci.insertText = new this.vscode.SnippetString(item.insertText);
            }
            return ci;
        });
    }
}

