/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SqlLanguageService } from '../../services/index.js';

export function createMultiQueryFoldService(
    service: SqlLanguageService,
): (
    state: { doc: { toString(): string; lineAt(pos: number): { from: number; to: number; number: number } } },
    lineStart: number,
    lineEnd: number,
) => { from: number; to: number } | null {
    return (state, lineStart, _lineEnd) => {
        const text = state.doc.toString();
        const foldable = service.getFoldableRegions(text);

        for (const region of foldable) {
            const startLine = state.doc.lineAt(region.contentStartOffset);
            if (startLine.from !== lineStart) continue;

            const endLine = state.doc.lineAt(region.contentEndOffset);
            if (endLine.number <= startLine.number) return null;

            return { from: startLine.to, to: endLine.to };
        }
        return null;
    };
}

