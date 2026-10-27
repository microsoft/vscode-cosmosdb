/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type ContainerModel, type ReadQuery } from '../webviews/cosmosdb/DataModeling/models';

export const APPLY_DATA_MODELING_QUERY_TOOL_NAME = 'cosmosdb_applyDataModelingQuery';
export const APPLY_DATA_MODELING_QUERY_TOOL_DESCRIPTION =
    'Applies a generated Cosmos DB NoSQL SELECT query to the originating Data Modeler read-query row. ' +
    'Use the wizardTabId and requestId from the generation request. This does not execute the query or update a Query Editor. ' +
    'Send either query (SQL only) or error explaining why generation could not be completed, never both. ' +
    'The query is applied only if the original row and modeled schema have not changed.';

export const QueryGenerationRequestSchema = z.object({
    requestId: z.string().uuid(),
    container: z.object({
        id: z.string().min(1),
        entity: z.string(),
        partitionKey: z.string(),
        properties: z.array(
            z.object({
                name: z.string(),
                type: z.string(),
                hasArrayAncestor: z.boolean().optional(),
                hasNonScalarValues: z.boolean().optional(),
            }),
        ),
    }),
    read: z.object({ id: z.string().min(1), pattern: z.string().refine((value) => !!value.trim()) }),
});

export const QueryGenerationResultSchema = z
    .object({
        requestId: z.string().uuid(),
        query: z.string().trim().min(1).optional(),
        error: z.string().trim().min(1).optional(),
    })
    .refine((value) => (value.query === undefined) !== (value.error === undefined));

export const QueryGenerationOutcomeSchema = z.enum(['applied', 'stale', 'error', 'invalidQuery']);
export type QueryGenerationRequest = z.infer<typeof QueryGenerationRequestSchema>;
export type QueryGenerationResult = z.infer<typeof QueryGenerationResultSchema>;
export type QueryGenerationOutcome = z.infer<typeof QueryGenerationOutcomeSchema>;

export function queryGenerationContext(container: ContainerModel, read: ReadQuery) {
    return {
        container: {
            id: container.id,
            entity: container.entity,
            partitionKey: container.partitionKey,
            properties: container.properties.map(({ name, type, hasArrayAncestor, hasNonScalarValues }) => ({
                name,
                type,
                hasArrayAncestor,
                hasNonScalarValues,
            })),
        },
        read: { id: read.id, pattern: read.pattern },
    };
}

export function queryGenerationFingerprint(container: ContainerModel, read: ReadQuery): string {
    return JSON.stringify({ ...queryGenerationContext(container, read), query: read.query, filters: read.filters });
}
