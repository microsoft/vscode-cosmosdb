/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Diagnostic } from '@codemirror/lint';
import { type EditorView } from '@codemirror/view';
import { type SqlLanguageService } from '../../services/index.js';
import { mapSeverity } from './types.js';

export function createLintSource(service: SqlLanguageService): (view: EditorView) => Diagnostic[] {
    return (view: EditorView) => {
        const query: string = view.state.doc.toString();
        const diags = service.getDiagnostics(query);

        return diags.map((d) => ({
            from: d.range.startOffset,
            to: d.range.endOffset,
            severity: mapSeverity(d.severity),
            message: d.message,
            source: d.source ?? 'cosmosdb-sql',
        }));
    };
}

