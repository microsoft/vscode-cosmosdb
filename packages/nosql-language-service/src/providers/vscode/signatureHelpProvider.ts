/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeApi from 'vscode';
import { type SqlLanguageService } from '../../services/index.js';
import { type VSCodeNamespace } from './types.js';

export class VSCodeSignatureHelpProvider implements vscodeApi.SignatureHelpProvider {
    private readonly vscode: VSCodeNamespace;
    private readonly service: SqlLanguageService;

    constructor(vscode: VSCodeNamespace, service: SqlLanguageService) {
        this.vscode = vscode;
        this.service = service;
    }

    provideSignatureHelp(
        document: vscodeApi.TextDocument,
        position: vscodeApi.Position,
    ): vscodeApi.SignatureHelp | null {
        const query = document.getText();
        const offset = document.offsetAt(position);
        const result = this.service.getSignatureHelp(query, offset);
        if (!result) return null;

        const sh = new this.vscode.SignatureHelp();
        sh.activeSignature = result.activeSignature;
        sh.activeParameter = result.activeParameter;
        sh.signatures = result.signatures.map((sig) => {
            const si = new this.vscode.SignatureInformation(sig.label, sig.documentation);
            si.parameters = sig.parameters.map((p) => new this.vscode.ParameterInformation(p.label, p.documentation));
            return si;
        });
        return sh;
    }
}

