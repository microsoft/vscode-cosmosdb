/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';

// ─── PartitionKey ───────────────────────────────────────────────────────────

/**
 * Matches the `PartitionKey` type from `@azure/cosmos`.
 * A partition key can be a primitive, null, an array of primitives, or undefined.
 */
const PartitionKeyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]);

export const PartitionKeySchema = z.union([PartitionKeyValueSchema, z.array(PartitionKeyValueSchema)]);

// ─── PartitionKeyDefinition ─────────────────────────────────────────────────

/**
 * Matches the `PartitionKeyDefinition` type from `@azure/cosmos`.
 */
export const PartitionKeyDefinitionSchema = z.object({
    paths: z.array(z.string()),
    kind: z.string().optional(),
    version: z.number().optional(),
    systemKey: z.boolean().optional(),
});
