/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Source-position helpers for the parser.
//
// Must be null-safe because during Chevrotain grammar recording phase,
// CONSUME/SUBRULE returns stubs (undefined/NaN properties).
// ---------------------------------------------------------------------------

import { type IToken } from 'chevrotain';
import { type SqlNodeBase } from '../ast/nodes.js';
import { type SourcePosition, type SourceRange } from '../errors/SqlError.js';

export function pos(token: IToken | undefined): SourcePosition {
    return {
        offset: token?.startOffset ?? 0,
        line: token?.startLine ?? 1,
        col: token?.startColumn ?? 1,
    };
}

export function posEnd(token: IToken | undefined): SourcePosition {
    return {
        offset: (token?.endOffset ?? token?.startOffset ?? 0) + 1,
        line: token?.endLine ?? token?.startLine ?? 1,
        col: (token?.endColumn ?? token?.startColumn ?? 0) + 1,
    };
}

export function range(start: IToken | undefined, end: IToken | undefined): SourceRange {
    return { start: pos(start), end: posEnd(end) };
}

export function rangeFromNodes(
    first: SqlNodeBase | undefined,
    last: SqlNodeBase | undefined,
): SourceRange | undefined {
    if (first?.range && last?.range) {
        return { start: first.range.start, end: last.range.end };
    }
    return first?.range ?? last?.range;
}

export function rangeStartEnd(
    startNode: { range?: SourceRange } | undefined,
    endToken: IToken | undefined,
): SourceRange {
    return {
        start: startNode?.range?.start ?? pos(endToken),
        end: posEnd(endToken),
    };
}

