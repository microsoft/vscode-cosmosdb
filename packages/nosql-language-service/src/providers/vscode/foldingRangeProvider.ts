/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type VSCodeNamespace } from './types.js';

export class VSCodeFoldingRangeProvider implements vscodeApi.FoldingRangeProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideFoldingRanges(document: vscodeApi.TextDocument): vscodeApi.FoldingRange[] {
        const text = document.getText();
        const foldable = this.service.getFoldableRegions(text);

        const ranges: vscodeApi.FoldingRange[] = [];
        for (const region of foldable) {
            const startPos = document.positionAt(region.contentStartOffset);
            const endPos = document.positionAt(region.contentEndOffset);
            if (endPos.line > startPos.line) {
                ranges.push(new this.vscode.FoldingRange(startPos.line, endPos.line));
            }
        }
        return ranges;
    }
}

