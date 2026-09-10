/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { MAX_CONTAINERS, type ContainerModel } from '../webviews/cosmosdb/DataModeling/models';
import { PartitionKeyRecommendationSchema } from './recommendationSchema';
import { ScoringWeightsSchema } from './scoring';

const PropertyRoleSchema = z.enum(['key', 'filter', 'payload']);
const ContainerModelSchema: z.ZodType<ContainerModel> = z.object({
    id: z.string().min(1),
    entity: z.string(),
    partitionKey: z.string(),
    properties: z.array(
        z.object({
            id: z.string().min(1),
            name: z.string(),
            type: z.enum(['string', 'string (ISO)', 'number', 'boolean', 'array', 'object', 'number[]', 'guid']),
            role: PropertyRoleSchema,
            pkCandidate: z.boolean(),
        }),
    ),
    document: z.object({ attributeCount: z.number(), avgSizeKb: z.number(), maxSizeKb: z.number() }),
    arrays: z.object({
        hasArrays: z.boolean(),
        avgItems: z.number(),
        maxItems: z.number(),
        updatePattern: z.enum(['none', 'append', 'patch', 'replace']),
    }),
    reads: z.array(z.object({ id: z.string().min(1), pattern: z.string(), filters: z.string(), qps: z.number() })),
    writes: z.object({ insertsPerSec: z.number(), updatesPerSec: z.number(), deletesPerSec: z.number() }),
    scale: z.object({
        candidates: z.array(
            z.object({
                id: z.string().min(1),
                attribute: z.string(),
                role: PropertyRoleSchema,
                distinctValues: z.number(),
            }),
        ),
        items: z.enum(['low', 'medium', 'high', 'very-high']),
        writes: z.enum(['even', 'skewed', 'time']),
        growth: z.enum(['bounded', 'slow', 'rapid']),
    }),
});

export const WizardStateSchema: z.ZodType<WizardState> = z
    .object({
        step: z.number().int().min(1),
        reachedSteps: z.array(z.string()).optional(),
        scenario: z
            .enum([
                'chat',
                'ecommerce',
                'iot',
                'multitenant',
                'rag',
                'social',
                'catalog',
                'gaming',
                'profiles',
                'eventsourcing',
                'analytics',
                'cms',
                'ledger',
                'inventory',
                'booking',
                'other',
            ])
            .optional(),
        dataModel: z.object({
            containers: z.array(ContainerModelSchema).max(MAX_CONTAINERS),
            activeContainerId: z.string().optional(),
        }),
        weights: z.object({ read: z.number(), write: z.number(), storage: z.number() }),
    })
    .superRefine((state, ctx) => {
        const containers = state.dataModel.containers;
        if (state.step > containers.length + 3) {
            ctx.addIssue({ code: 'custom', message: 'Invalid wizard step.', path: ['step'] });
        }
        if (new Set(containers.map((c) => c.id)).size !== containers.length) {
            ctx.addIssue({
                code: 'custom',
                message: 'Duplicate container identifiers.',
                path: ['dataModel', 'containers'],
            });
        }
        if (state.dataModel.activeContainerId && !containers.some((c) => c.id === state.dataModel.activeContainerId)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Unknown active container.',
                path: ['dataModel', 'activeContainerId'],
            });
        }
    });

export const ModelingAdvisorSnapshotSchema = z
    .object({
        wizard: WizardStateSchema,
        recommendation: z.object({
            status: z.enum(['idle', 'waiting', 'received', 'error']),
            value: PartitionKeyRecommendationSchema.optional(),
            error: z.string().optional(),
            /** Snapshot of priorities at request time; never inferred from later Review edits. */
            weights: ScoringWeightsSchema.optional(),
        }),
    })
    .refine(
        (snapshot) => snapshot.recommendation.status !== 'received' || snapshot.recommendation.value !== undefined,
        {
            message: 'A received recommendation requires a result.',
            path: ['recommendation', 'value'],
        },
    );
export type ModelingAdvisorSnapshot = z.infer<typeof ModelingAdvisorSnapshotSchema>;

/** Versioned, human-readable stored project, matching migration's version/name envelope. */
export const ModelingAdvisorProjectSchema = z.object({
    version: z.literal(1),
    name: z.string(),
    state: ModelingAdvisorSnapshotSchema,
});
export type ModelingAdvisorProject = z.infer<typeof ModelingAdvisorProjectSchema>;
