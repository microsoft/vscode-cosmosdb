/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IToken } from 'chevrotain';
import { type SourcePosition, type SourceRange } from './SqlError.js';

/** Maps UTF-16 offsets to 1-based positions, treating LF, CRLF and CR as line breaks. */
export function offsetToPosition(text: string, offset: number): SourcePosition {
    return createPositionResolver(text)(offset);
}

/** Pre-indexes lines for repeated lookups without rescanning the query for every diagnostic. */
export function createPositionResolver(text: string): (offset: number) => SourcePosition {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\r' || text[i] === '\n') {
            if (text[i] === '\r' && text[i + 1] === '\n') i++;
            lineStarts.push(i + 1);
        }
    }
    return (offset) => {
        const end = Math.max(0, Math.min(offset, text.length));
        let low = 0;
        let high = lineStarts.length;
        while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (lineStarts[middle] <= end) low = middle;
            else high = middle;
        }
        return { offset: end, line: low + 1, col: end - lineStarts[low] + 1 };
    };
}

export function tokenToSourceRange(
    text: string,
    token: IToken,
    positionAt: (offset: number) => SourcePosition,
): SourceRange {
    const start = Number.isFinite(token.startOffset) ? token.startOffset : text.length;
    const end = token.endOffset !== undefined && Number.isFinite(token.endOffset) ? token.endOffset + 1 : start;
    return { start: positionAt(start), end: positionAt(end) };
}
