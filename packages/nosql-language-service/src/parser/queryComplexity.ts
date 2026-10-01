/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IToken } from 'chevrotain';
import { type SqlProgram } from '../ast/nodes.js';

export const MAX_PARSER_RULE_DEPTH = 512;
export const MAX_AST_DEPTH = 256;

export class QueryTooComplexError extends Error {
    constructor(readonly token: IToken) {
        super(`Query exceeds the maximum parser rule depth of ${MAX_PARSER_RULE_DEPTH}.`);
    }
}

export function exceedsAstDepth(ast: SqlProgram | undefined): boolean {
    const pending: { value: unknown; depth: number }[] = [{ value: ast, depth: 1 }];
    while (pending.length > 0) {
        const entry = pending.pop()!;
        if (Array.isArray(entry.value)) {
            for (const value of entry.value) pending.push({ value, depth: entry.depth });
        } else if (entry.value && typeof entry.value === 'object' && 'kind' in entry.value) {
            if (entry.depth > MAX_AST_DEPTH) return true;
            for (const value of Object.values(entry.value)) {
                pending.push({ value, depth: entry.depth + 1 });
            }
        }
    }
    return false;
}
