/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type VSCodeNamespace } from './types.js';

export class VSCodeHoverProvider implements vscodeApi.HoverProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideHover(document: vscodeApi.TextDocument, position: vscodeApi.Position): vscodeApi.Hover | null {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const info = this.service.getHoverInfo(query, offset);
        if (!info) return null;

        const md = new this.vscode.MarkdownString(info.contents.join('\n\n'), true);
        md.isTrusted = true;

        let range: vscodeApi.Range | undefined;
        if (info.range) {
            range = new this.vscode.Range(
                new this.vscode.Position(info.range.startLine - 1, info.range.startColumn - 1),
                new this.vscode.Position(info.range.endLine - 1, info.range.endColumn - 1),
            );
        }
        return new this.vscode.Hover(md, range);
    }
}

