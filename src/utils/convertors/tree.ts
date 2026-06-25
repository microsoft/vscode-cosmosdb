/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tree conversion: turn a SerializedQueryResult into a hierarchical TreeRow[] for the tree view.
 *
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future.
 */

import { type ItemDefinition, type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { extractPartitionKeyValues, getDocumentId } from '../document';
import { QueryResultMismatchError, getDocumentCollectionKind, getQueryResultKind } from '../queryAnalysis';
import { leftPadIndex, toStringUniversal } from '../strings';
import { buildTableHeadersFromObjectDocuments } from './table';
import { MAX_TREE_LEVEL_LENGTH, type TreeRow } from './types';

/**
 * Get the type name for a value
 */
const getTypeName = (value: unknown): string => {
    if (value === null) return 'Null';
    if (value === undefined) return 'Undefined';
    if (Array.isArray(value)) return 'Array';

    const type = typeof value;
    return type.charAt(0).toUpperCase() + type.slice(1);
};

/**
 * Get the display value for a tree row
 */
const getDisplayValue = (value: unknown): string => {
    if (Array.isArray(value)) return `(elements: ${value.length})`;
    if (value && typeof value === 'object') return '{...}';
    return toStringUniversal(value);
};

/**
 * Convert a value to a TreeRow with nested children
 */
const valueToTreeRow = (id: string, field: string, value: unknown): TreeRow => {
    const row: TreeRow = {
        id,
        field,
        value: getDisplayValue(value),
        type: getTypeName(value),
        isExpanded: false,
    };

    if (Array.isArray(value)) {
        const children: TreeRow[] = [];
        const arrayLength = Math.min(value.length, MAX_TREE_LEVEL_LENGTH);

        for (let i = 0; i < arrayLength; i++) {
            children.push(valueToTreeRow(`${id}-${leftPadIndex(i, arrayLength + 1)}`, `${i}`, value[i]));
        }

        if (value.length > MAX_TREE_LEVEL_LENGTH) {
            children.push({
                id: `${id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, arrayLength + 1)}`,
                field: '',
                value: l10n.t('Array is too large to be shown'),
                type: 'String',
            });
        }

        if (children.length > 0) {
            row.children = children;
        }
    } else if (value && typeof value === 'object') {
        const children: TreeRow[] = [];
        const sortedKeys = Object.keys(value).sort((a, b) => a.localeCompare(b));
        const objectLength = Math.min(sortedKeys.length, MAX_TREE_LEVEL_LENGTH);

        for (let i = 0; i < objectLength; i++) {
            const key = sortedKeys[i];
            children.push(
                valueToTreeRow(
                    `${id}-${leftPadIndex(i, objectLength + 1)}`,
                    key,
                    (value as Record<string, unknown>)[key],
                ),
            );
        }

        if (sortedKeys.length > MAX_TREE_LEVEL_LENGTH) {
            children.push({
                id: `${id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, objectLength + 1)}`,
                field: '',
                value: l10n.t('Object is too large to be shown'),
                type: 'String',
            });
        }

        if (children.length > 0) {
            row.children = children;
        }
    }

    return row;
};

/**
 * Convert a document to a hierarchical TreeRow.
 * Caller must ensure the document is a plain object (not null / scalar / array).
 */
const documentToTreeRow = async (
    document: JSONObject,
    partitionKey: PartitionKeyDefinition | undefined,
    rootId: string,
): Promise<TreeRow> => {
    const headers = buildTableHeadersFromObjectDocuments([document], partitionKey, {
        ShowPartitionKey: 'first',
        ShowServiceColumns: 'last',
        Sorting: 'ascending',
        TruncateValues: MAX_TREE_LEVEL_LENGTH,
    });
    const partitionKeyValues = extractPartitionKeyValues(document, partitionKey);

    // Build children for all headers
    const children: TreeRow[] = [];
    for (let index = 0; index < headers.length; index++) {
        const header = headers[index];
        const value = header.startsWith('/') ? partitionKeyValues[header] : (document[header] as unknown);
        children.push(valueToTreeRow(`${rootId}-${leftPadIndex(index, headers.length)}`, header, value));

        // Yield to the event loop periodically to avoid UI freezes
        if (index % 500 === 0 && index > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    // Return root document row with children
    return {
        id: rootId,
        documentId: getDocumentId(document, partitionKey),
        field:
            typeof document['id'] === 'string' && document['id']
                ? document['id']
                : `${rootId} (Index number, id is missing)`,
        value: '',
        type: 'Document',
        children: children.length > 0 ? children : undefined,
        isExpanded: false,
    };
};

export const queryResultToTree = async (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
): Promise<TreeRow[]> => {
    if (!queryResult?.documents?.length) {
        return [];
    }

    const queryKind = getQueryResultKind(queryResult.query);
    const dataKind = getDocumentCollectionKind(queryResult.documents);

    // Tree view only makes sense for structured object documents
    if (dataKind === 'empty' || dataKind === 'primitive') {
        return [];
    }
    if (queryKind === 'object' && dataKind !== 'object') {
        throw new QueryResultMismatchError(queryKind, dataKind);
    }
    if (dataKind !== 'object') {
        // unknown queryKind with mixed/primitive data — cannot render as tree
        return [];
    }

    const rows: TreeRow[] = [];
    const docsLength = queryResult.documents.length;

    for (let i = 0; i < docsLength; i++) {
        // dataKind === 'object' is guaranteed by the guard above
        const doc = queryResult.documents[i] as ItemDefinition;
        const docRow = await documentToTreeRow(doc, partitionKey, leftPadIndex(i, docsLength));
        rows.push(docRow);

        // Yield to the event loop periodically to avoid UI freezes
        if (i % 100 === 0 && i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return rows;
};
