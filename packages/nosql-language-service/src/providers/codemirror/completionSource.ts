/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { type SqlLanguageService } from '../../services/index.js';
import { mapCompletionKind } from './types.js';

export function createCompletionSource(
    service: SqlLanguageService,
): (context: CompletionContext) => CompletionResult | null {
    return (context: CompletionContext) => {
        const query: string = context.state.doc.toString();
        const offset: number = context.pos;

        const items = service.getCompletions(query, offset);
        if (items.length === 0) return null;

        const before = query.substring(0, offset);
        const wordMatch = before.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        const from = wordMatch ? offset - wordMatch[0].length : offset;

        return {
            from,
            options: items.map((item) => ({
                label: item.label,
                type: mapCompletionKind(item.kind),
                detail: item.detail,
                apply: item.insertText ?? item.label,
                boost: item.sortText ? 1000 - parseInt(item.sortText.substring(0, 4), 10) : 0,
            })),
        };
    };
}

