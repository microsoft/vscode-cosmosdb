/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type VSCodeNamespace } from './types.js';

export class VSCodeFormattingProvider implements vscodeApi.DocumentFormattingEditProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideDocumentFormattingEdits(document: vscodeApi.TextDocument): vscodeApi.TextEdit[] {
        const query = document.getText();
        const edits = this.service.getFormatEdits(query);
        return edits.map((e) =>
            this.vscode.TextEdit.replace(
                new this.vscode.Range(
                    new this.vscode.Position(e.range.startLine - 1, e.range.startColumn - 1),
                    new this.vscode.Position(e.range.endLine - 1, e.range.endColumn - 1),
                ),
                e.newText,
            ),
        );
    }
}

