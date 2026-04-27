/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Autocomplete for CosmosDB NoSQL SQL
//
// Takes a query string, cursor offset, and JSON Schema of the collection.
// Returns completion items suitable for mapping to Monaco CompletionItems.
// ---------------------------------------------------------------------------

import { expressionKeywordsRanked, extractDotExpression, functionItems, kwp } from './completionHelpers.js';
import { CompletionContext, detectContext, detectUsedSelectModifiers } from './contextDetection.js';
import { getFieldsFromSchema } from './schemaFields.js';
import { type CompletionItem, type CompletionRequest } from './types.js';

/** Re-exports so consumers can import everything from this module */
export type { CompletionItem, CompletionItemKind, CompletionRequest, JSONSchema } from './types.js';

// ========================== Main entry point ==================================

export function getCompletions(request: CompletionRequest): CompletionItem[] {
    const { query, offset, schema, aliases: userAliases } = request;
    const ctx = detectContext(query, offset);
    const aliases = userAliases ?? ctx.aliases;

    const items: CompletionItem[] = [];

    switch (ctx.context) {
        case CompletionContext.QueryStart:
            items.push(kwp('SELECT', 1));
            break;

        case CompletionContext.AfterSelect: {
            // sql.y: SELECT [DISTINCT] [TOP N] selection
            // Determine which modifiers were already used by scanning tokens before cursor
            const usedModifiers = detectUsedSelectModifiers(query, offset);

            // After VALUE — only expressions (no *, no modifiers)
            if (usedModifiers.hasValue) {
                for (const alias of aliases) {
                    items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
                }
                items.push(...functionItems(20));
                break;
            }

            // Projection items: *, aliases, functions
            items.push({ label: '*', kind: 'keyword', sortText: '0001*' });
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0002' + alias });
            }
            // Modifiers — only suggest what hasn't been used yet and respects order
            // DISTINCT must come before TOP; TOP before projection
            if (!usedModifiers.hasTop && !usedModifiers.hasDistinct) {
                items.push(kwp('DISTINCT', 10));
            }
            if (!usedModifiers.hasTop) {
                items.push(kwp('TOP', 8));
            }
            if (!usedModifiers.hasValue) {
                items.push(kwp('VALUE', 12));
            }

            items.push(...functionItems(50));
            break;
        }

        case CompletionContext.InSelectList:
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            items.push(...functionItems(20));
            break;

        case CompletionContext.AfterSelectSpec:
            // After SELECT projection — suggest clause keywords
            items.push(kwp('FROM', 1)); // most common next clause
            items.push(kwp('WHERE', 5));
            items.push(kwp('ORDER BY', 10));
            items.push(kwp('GROUP BY', 15));
            items.push(kwp('JOIN', 18));
            items.push(kwp('OFFSET', 20));
            break;

        case CompletionContext.AfterFrom:
            // Nothing useful from schema here — user types collection name
            break;

        case CompletionContext.AfterFromClause:
            // Ordered by frequency in real queries
            items.push(kwp('WHERE', 1)); // most common after FROM
            items.push(kwp('ORDER BY', 5));
            items.push(kwp('JOIN', 10));
            items.push(kwp('GROUP BY', 15));
            items.push(kwp('OFFSET', 20));
            break;

        case CompletionContext.AfterWhere:
        case CompletionContext.InWhereExpression:
        case CompletionContext.InExpression:
        case CompletionContext.InFunctionArgs:
            // In expression: aliases first, then keywords, then functions
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            items.push(...expressionKeywordsRanked());
            items.push(...functionItems(30));
            break;

        case CompletionContext.AfterDot: {
            // "c." → suggest fields from schema
            const fullDotExpr = extractDotExpression(query, offset);
            const parts = fullDotExpr.split('.');
            const rootAlias = parts[0];
            const path = parts.slice(1, -1); // segments between root alias and cursor

            // Suggest schema fields if root matches a known alias, OR if no
            // FROM clause has been typed yet (user is still composing the query).
            if (aliases.includes(rootAlias) || aliases.length === 0) {
                items.push(...getFieldsFromSchema(schema, path));
            }
            break;
        }

        case CompletionContext.AfterOrder:
            items.push(kwp('BY', 1));
            break;

        case CompletionContext.AfterGroup:
            items.push(kwp('BY', 1));
            break;

        case CompletionContext.AfterOrderBy:
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0001' + alias });
            }
            break;

        case CompletionContext.Unknown:
            // Fallback: clause keywords (ranked), then aliases, then functions
            items.push(kwp('SELECT', 1));
            items.push(kwp('WHERE', 5));
            items.push(kwp('FROM', 8));
            items.push(kwp('ORDER BY', 10));
            items.push(kwp('GROUP BY', 15));
            items.push(kwp('JOIN', 18));
            items.push(kwp('OFFSET', 20));
            items.push(kwp('LIMIT', 22));
            for (const alias of aliases) {
                items.push({ label: alias, kind: 'alias', sortText: '0030' + alias });
            }
            items.push(...functionItems(50));
            break;
    }

    // Filter by typing prefix
    const prefix = ctx.typingPrefix.toLowerCase();
    if (prefix) {
        return items.filter((item) => item.label.toLowerCase().startsWith(prefix));
    }
    return items;
}
