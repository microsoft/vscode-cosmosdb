/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse, type SqlNode, type SqlScalarExpression } from '@azure/cosmosdb-nosql-language-service';
import { type ReadQuery } from './models';

function isNode(value: unknown): value is SqlNode {
    return typeof value === 'object' && value !== null && 'kind' in value;
}

function propertyPath(expression: SqlScalarExpression): string[] | undefined {
    if (expression.kind === 'PropertyRefScalarExpression') {
        if (!expression.member) {
            return [expression.identifier.value];
        }
        const parent = propertyPath(expression.member);
        return parent ? [...parent, expression.identifier.value] : undefined;
    }
    if (
        expression.kind === 'MemberIndexerScalarExpression' &&
        expression.indexer.kind === 'LiteralScalarExpression' &&
        expression.indexer.literal.kind === 'StringLiteral'
    ) {
        const parent = propertyPath(expression.member);
        return parent ? [...parent, expression.indexer.literal.value] : undefined;
    }
    return undefined;
}

function collectAliases(value: unknown, aliases: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach((child) => collectAliases(child, aliases));
    } else if (isNode(value) && value.kind !== 'Query') {
        if (value.kind === 'AliasedCollectionExpression' && value.alias) {
            aliases.add(value.alias.value);
        } else if (value.kind === 'InputPathCollection' || value.kind === 'ArrayIteratorCollectionExpression') {
            aliases.add(value.identifier.value);
        }
        Object.values(value).forEach((child) => collectAliases(child, aliases));
    }
}

/** Match actual property references, not parameters, comments, string values, or identifier substrings. */
export function queryPropertyNames(query: string): { names: string[]; valid: boolean } {
    if (!query.trim()) {
        return { names: [], valid: true };
    }
    const { ast, errors } = parse(query);
    const names = new Set<string>();
    function visit(value: unknown, aliases: Set<string>): void {
        if (Array.isArray(value)) {
            value.forEach((child) => visit(child, aliases));
        } else if (isNode(value)) {
            if (value.kind === 'Query') {
                // FROM follows SELECT in the AST; resolve aliases before processing any references in this scope.
                aliases = new Set(aliases);
                collectAliases(value.from, aliases);
            }
            if (value.kind === 'PropertyRefScalarExpression' || value.kind === 'MemberIndexerScalarExpression') {
                const path = propertyPath(value);
                if (path) {
                    const segments = aliases.has(path[0]) ? path.slice(1) : path;
                    if (segments.length) {
                        names.add(segments.join('/'));
                    }
                    // The member nodes belong to this reference, not separate references to its parent properties.
                    return;
                }
            }
            Object.values(value).forEach((child) => visit(child, aliases));
        }
    }
    visit(ast, new Set());
    return { names: [...names], valid: errors.length === 0 };
}

/** Preserve saved selections and derive the initial selection from legacy/catalog predicates. */
export function readFilterProperties(read: Pick<ReadQuery, 'filters'>): string[] {
    return Array.isArray(read.filters)
        ? read.filters
        : queryPropertyNames(read.filters.trim() ? `SELECT ${read.filters} FROM c` : '').names;
}
