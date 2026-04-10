/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKey, type PartitionKeyDefinition } from '@azure/cosmos';
import { z } from 'zod';

// ─── PartitionKey ───────────────────────────────────────────────────────────

/**
 * Matches the `PartitionKey` type from `@azure/cosmos`.
 * A partition key can be a primitive, null, an array of primitives, or undefined.
 *
 * Cast to `z.ZodType<PartitionKey>` so that `z.infer` produces the exact
 * `PartitionKey` type, eliminating `as PartitionKey` casts in event handlers.
 */
const PartitionKeyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]);

export const PartitionKeySchema = z.union([
    PartitionKeyValueSchema,
    z.array(PartitionKeyValueSchema),
]) as unknown as z.ZodType<PartitionKey>;

// ─── PartitionKeyDefinition ─────────────────────────────────────────────────

/**
 * Matches the `PartitionKeyDefinition` type from `@azure/cosmos`.
 *
 * Cast to `z.ZodType<PartitionKeyDefinition>` so that `z.infer` produces
 * the exact `PartitionKeyDefinition` type, eliminating `as` casts downstream.
 */
export const PartitionKeyDefinitionSchema = z.object({
    paths: z.array(z.string()),
    kind: z.string().optional(),
    version: z.number().optional(),
    systemKey: z.boolean().optional(),
}) as unknown as z.ZodType<PartitionKeyDefinition>;
