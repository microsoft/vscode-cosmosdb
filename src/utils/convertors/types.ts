/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBRecordIdentifier } from '../../cosmosdb/types/queryResult';

/** Max number of array elements / object keys rendered per tree level, and default value truncation length. */
export const MAX_TREE_LEVEL_LENGTH = 100;

export type StatsItem = {
    metric: string;
    value: string | number;
    formattedValue: string;
    tooltip: string;
};

/** Row metadata — never overlaps with document field names */
export type TableRowMeta = {
    __id: string;
    __documentId?: CosmosDBRecordIdentifier;
};

/**
 * A single table row.
 * `__id` and `__documentId` are internal; all other keys are raw document
 * values (not pre-serialized). The UI layer calls `toStringUniversal` at render time.
 */
export type TableRecord = TableRowMeta & {
    [key: string]: unknown;
};

export type TableData = {
    headers: string[];
    dataset: TableRecord[];
};

/**
 * Tree row format for hierarchical tree view.
 * Uses nested children array for tree structure.
 */
export type TreeRow = {
    id: string;
    documentId?: CosmosDBRecordIdentifier;
    field: string;
    value: string;
    type: string;
    children?: TreeRow[];
    isExpanded?: boolean;
};

export type ColumnOptions = {
    ShowPartitionKey: 'first' | 'none'; // 'first' = show id + partition key first, 'none' = the nested partition key values are hidden + partition key are shown as is (without / prefix)
    ShowServiceColumns: 'last' | 'none'; // 'last' = show service columns last, 'none' = hide service columns
    Sorting: 'ascending' | 'descending' | 'none'; // 'ascending' = sort columns in ascending order, 'descending' = sort columns in descending order, 'none' = no sorting
    TruncateValues: number; // truncate values to this length, 0 = no truncation
};
