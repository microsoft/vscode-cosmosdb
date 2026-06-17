/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API for CSV export. Split into focused modules:
 *   - escape.ts  — value quoting + separator resolution
 *   - metrics.ts — query metrics → CSV
 *   - table.ts   — query result rows → CSV
 */

export { escapeCsvValue } from './escape';
export { queryMetricsToCsv } from './metrics';
export { queryResultToCsv } from './table';
