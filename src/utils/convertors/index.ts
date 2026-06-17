/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API for query-result conversion. Split into focused modules:
 *   - json.ts    — document JSON serialization
 *   - table.ts   — table (headers + rows) conversion
 *   - tree.ts    — hierarchical tree conversion
 *   - metrics.ts — query-metrics → stats table / JSON
 *
 * Internal helpers (e.g. buildTableHeadersFromObjectDocuments) are intentionally NOT re-exported
 * here to keep the public surface identical to the previous single-file module.
 */

export type { ColumnOptions, StatsItem, TableData, TableRecord, TableRowMeta, TreeRow } from './types';
export { queryResultToJSON } from './json';
export { queryResultToTable } from './table';
export { queryResultToTree } from './tree';
export { indexMetricsToTableItem, queryMetricsToJSON, queryMetricsToTable } from './metrics';
