/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse, type SqlNode } from '@azure/cosmosdb-nosql-language-service';
import { type ReadQuery } from './models';

function isNode(value: unknown): value is SqlNode {
    return typeof value === 'object' && value !== null && 'kind' in value;
}

/** Match actual property references, not parameters, comments, string values, or identifier substrings. */
export function queryPropertyNames(query: string): { names: string[]; valid: boolean } {
    if (!query.trim()) {
        return { names: [], valid: true };
    }
    const { ast, errors } = parse(query);
    const names = new Set<string>();
    const aliases = new Set<string>();
    const bareNames = new Set<string>();
    function visit(value: unknown): void {
        if (Array.isArray(value)) {
            value.forEach(visit);
        } else if (isNode(value)) {
            if (value.kind === 'PropertyRefScalarExpression') {
                (value.member ? names : bareNames).add(value.identifier.value);
            } else if (
                value.kind === 'MemberIndexerScalarExpression' &&
                value.indexer.kind === 'LiteralScalarExpression' &&
                value.indexer.literal.kind === 'StringLiteral'
            ) {
                names.add(value.indexer.literal.value);
            } else if (value.kind === 'AliasedCollectionExpression') {
                if (value.alias) {
                    aliases.add(value.alias.value);
                }
            } else if (value.kind === 'InputPathCollection') {
                aliases.add(value.identifier.value);
            }
            Object.values(value).forEach(visit);
        }
    }
    visit(ast);
    bareNames.forEach((name) => {
        if (!aliases.has(name)) {
            names.add(name);
        }
    });
    return { names: [...names], valid: errors.length === 0 };
}

/** Preserve saved selections and derive the initial selection from legacy/catalog predicates. */
export function readFilterProperties(read: Pick<ReadQuery, 'filters'>): string[] {
    return Array.isArray(read.filters)
        ? read.filters
        : queryPropertyNames(read.filters.trim() ? `SELECT ${read.filters} FROM c` : '').names;
}
