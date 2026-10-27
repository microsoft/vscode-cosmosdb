/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    parse,
    type SqlCollection,
    type SqlCollectionExpression,
    type SqlNode,
    type SqlScalarExpression,
} from '@azure/cosmosdb-nosql-language-service';
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

function collectionPath(collection: SqlCollection, aliases: Map<string, string[]>): string[] {
    if (collection.kind === 'SubqueryCollection') {
        return [];
    }
    const segments: string[] = [];
    for (let path = collection.path; path; path = path.parentPath) {
        if (path.kind === 'IdentifierPathExpression') {
            segments.unshift(path.identifier.value);
        } else if (path.kind === 'StringPathExpression') {
            segments.unshift(path.value.value);
        }
    }
    return [...(aliases.get(collection.identifier.value) ?? []), ...segments];
}

function collectAliases(expression: SqlCollectionExpression, aliases: Map<string, string[]>): void {
    if (expression.kind === 'JoinCollectionExpression') {
        // Later iterators can refer to aliases introduced on the left side of the JOIN.
        collectAliases(expression.left, aliases);
        collectAliases(expression.right, aliases);
    } else if (expression.kind === 'ArrayIteratorCollectionExpression') {
        aliases.set(expression.identifier.value, collectionPath(expression.collection, aliases));
    } else {
        const collection = expression.collection;
        const alias =
            expression.alias?.value ??
            (collection.kind === 'InputPathCollection' ? collection.identifier.value : undefined);
        if (alias) {
            const path =
                collection.kind === 'InputPathCollection' && !collection.path
                    ? []
                    : collectionPath(collection, aliases);
            aliases.set(alias, path);
        }
    }
}

/** Resolve scoped collection aliases to property paths, excluding parameters, comments, and string values. */
export function queryPropertyNames(query: string): { names: string[]; valid: boolean } {
    if (!query.trim()) {
        return { names: [], valid: true };
    }
    const { ast, errors } = parse(query);
    const names = new Set<string>();
    function visit(value: unknown, aliases: Map<string, string[]>): void {
        if (Array.isArray(value)) {
            value.forEach((child) => visit(child, aliases));
        } else if (isNode(value)) {
            if (value.kind === 'Query') {
                // FROM follows SELECT in the AST; resolve aliases before processing any references in this scope.
                aliases = new Map(aliases);
                if (value.from) {
                    collectAliases(value.from.collection, aliases);
                }
            }
            if (value.kind === 'PropertyRefScalarExpression' || value.kind === 'MemberIndexerScalarExpression') {
                const path = propertyPath(value);
                if (path) {
                    const source = aliases.get(path[0]);
                    const segments = source ? (path.length > 1 ? [...source, ...path.slice(1)] : []) : path;
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
    visit(ast, new Map());
    return { names: [...names], valid: errors.length === 0 };
}

/** Preserve saved selections and derive the initial selection from legacy/catalog predicates. */
export function readFilterProperties(read: Pick<ReadQuery, 'filters'>): string[] {
    return Array.isArray(read.filters)
        ? read.filters
        : queryPropertyNames(read.filters.trim() ? `SELECT ${read.filters} FROM c` : '').names;
}

export function queryTextPatch(
    read: ReadQuery,
    query: string,
    propertyNames: string[],
): Pick<ReadQuery, 'query' | 'filters'> {
    const referenced = queryPropertyNames(query);
    const selected = readFilterProperties(read);
    return {
        query,
        filters: referenced.valid
            ? [...new Set([...selected, ...propertyNames.filter((name) => referenced.names.includes(name))])]
            : selected,
    };
}
