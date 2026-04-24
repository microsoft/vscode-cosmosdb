/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as monacoEditor from 'monaco-editor';
import { type SqlLanguageService } from '../../services/index.js';

/**
 * Standalone signature help provider for Monaco Editor.
 */
export class MonacoSignatureHelpProvider implements monacoEditor.languages.SignatureHelpProvider {
    readonly signatureHelpTriggerCharacters = ['(', ','];
    readonly signatureHelpRetriggerCharacters = [','];
    private readonly service: SqlLanguageService;

    constructor(service: SqlLanguageService) {
        this.service = service;
    }

    provideSignatureHelp(
        model: monacoEditor.editor.ITextModel,
        position: monacoEditor.Position,
    ): monacoEditor.languages.SignatureHelpResult | null {
        const query = model.getValue();
        const offset = model.getOffsetAt(position);
        const result = this.service.getSignatureHelp(query, offset);
        if (!result) return null;

        return {
            value: {
                signatures: result.signatures.map((sig) => ({
                    label: sig.label,
                    documentation: sig.documentation ? { value: sig.documentation, isTrusted: true } : undefined,
                    parameters: sig.parameters.map((p) => ({
                        label: p.label,
                        documentation: p.documentation ? { value: p.documentation, isTrusted: true } : undefined,
                    })),
                })),
                activeSignature: result.activeSignature,
                activeParameter: result.activeParameter,
            },
            dispose() {},
        };
    }
}

