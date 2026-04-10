/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { CosmosDBRecordIdentifierSchema } from './querySchemas';

// ─── OpenDocumentMode ───────────────────────────────────────────────────────

/**
 * Matches the `OpenDocumentMode` type: 'add' | 'edit' | 'view'.
 */
export const OpenDocumentModeSchema = z.enum(['add', 'edit', 'view']);

// ─── BulkDeleteResult ───────────────────────────────────────────────────────

/**
 * Matches the status object returned by `bulkDeleteDocuments`.
 */
export const BulkDeleteResultSchema = z.object({
    valid: z.array(CosmosDBRecordIdentifierSchema),
    invalid: z.array(CosmosDBRecordIdentifierSchema),
    deleted: z.array(CosmosDBRecordIdentifierSchema),
    throttled: z.array(CosmosDBRecordIdentifierSchema),
    failed: z.array(CosmosDBRecordIdentifierSchema),
    aborted: z.boolean(),
});
