/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Completion item helper factories for CosmosDB NoSQL SQL
// ---------------------------------------------------------------------------

import { FUNCTION_CATEGORIES } from './builtinFunctions.js';
import { CLAUSE_KEYWORDS, EXPRESSION_KEYWORDS } from './keywords.js';
import { type CompletionItem } from './types.js';

export function kw(label: string): CompletionItem {
    return { label, kind: 'keyword', sortText: '0200' + label };
}

/** Keyword with explicit priority (lower = higher in list) */
export function kwp(label: string, priority: number): CompletionItem {
    return { label, kind: 'keyword', sortText: String(priority).padStart(4, '0') + label };
}

export function clauseKeywords(): CompletionItem[] {
    return CLAUSE_KEYWORDS.map(kw);
}

/** Expression keywords ranked by frequency of use in real queries */
export function expressionKeywordsRanked(): CompletionItem[] {
    // Ordered by how commonly used in WHERE/expressions
    const ranked: [string, number][] = [
        ['AND', 5],
        ['OR', 8],
        ['NOT', 12],
        ['IN', 15],
        ['BETWEEN', 20],
        ['LIKE', 22],
        ['EXISTS', 25],
        ['IS', 28],
        ['NULL', 30],
        ['TRUE', 32],
        ['FALSE', 33],
        ['UNDEFINED', 35],
        ['ASC', 40],
        ['DESC', 41],
        ['ARRAY', 45],
    ];
    return ranked.map(([label, priority]) => kwp(label, priority));
}

export function expressionKeywords(): CompletionItem[] {
    return EXPRESSION_KEYWORDS.map(kw);
}

export function functionItems(basePriority: number = 30): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const [category, fns, catPriority] of FUNCTION_CATEGORIES) {
        for (let i = 0; i < fns.length; i++) {
            const name = fns[i];
            items.push({
                label: name,
                kind: 'function' as const,
                detail: category,
                insertText: name + '($0)',
                sortText: String(basePriority + catPriority + i).padStart(4, '0') + name,
            });
        }
    }
    return items;
}

export function extractDotExpression(query: string, offset: number): string {
    const before = query.substring(0, offset);
    const match = before.match(/([a-zA-Z_][a-zA-Z0-9_.]*\.?)$/);
    return match ? match[1] : '';
}

