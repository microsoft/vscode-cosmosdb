/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { hasReadEvidence, MAX_CONTAINERS, type ContainerModel } from '../webviews/cosmosdb/DataModeling/models';
import {
    assessContainerThroughput,
    getDataFieldErrors,
    getReadEvidenceMessage,
    getThroughputIssueMessage,
    MAX_OPERATIONS_PER_SEC,
} from '../webviews/cosmosdb/DataModeling/workloadLimits';
import { SuccessfulDeploymentSchema } from './deploymentModel';
import { PartitionKeyRecommendationSchema } from './recommendationSchema';

const PropertyRoleSchema = z.enum(['key', 'filter', 'payload']);
// Projects saved before workload limits were enforced may contain negative, fractional, or huge operation rates.
// Bring them into the accepted range instead of failing to load the whole project.
const OperationsPerSecSchema = z
    .number()
    .transform((value) => Math.min(Math.max(Math.round(value), 0), MAX_OPERATIONS_PER_SEC));
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
            hasArrayAncestor: z.boolean().optional(),
            hasNonScalarValues: z.boolean().optional(),
        }),
    ),
    document: z.object({
        attributeCount: z.number(),
        avgSizeKb: z.number(),
        maxSizeKb: z.number(),
    }),
    arrays: z.object({
        hasArrays: z.boolean(),
        avgItems: z.number(),
        maxItems: z.number(),
        updatePattern: z.enum(['none', 'append', 'patch', 'replace']),
    }),
    reads: z.array(
        z.object({
            id: z.string().min(1),
            pattern: z.string(),
            query: z.string().optional(),
            qps: OperationsPerSecSchema,
        }),
    ),
    writes: z.object({
        insertsPerSec: OperationsPerSecSchema,
        updatesPerSec: OperationsPerSecSchema,
        deletesPerSec: OperationsPerSecSchema,
    }),
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

const StoredWizardStateSchema: z.ZodType<WizardState> = z
    .object({
        step: z.number().int().min(1),
        reachedSteps: z.array(z.string()).optional(),
        inputsChangedSinceAdvance: z.boolean().optional(),
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

export const WizardStateSchema: z.ZodType<WizardState> = StoredWizardStateSchema.superRefine((state, ctx) => {
    for (const [index, container] of state.dataModel.containers.entries()) {
        for (const [field, message] of Object.entries(getDataFieldErrors(container))) {
            if (message) {
                ctx.addIssue({
                    code: 'custom',
                    message,
                    path: [
                        'dataModel',
                        'containers',
                        index,
                        field === 'avgItems' || field === 'maxItems' ? 'arrays' : 'document',
                        field,
                    ],
                });
            }
        }
        for (const issue of assessContainerThroughput(container)) {
            if (issue.severity === 'error') {
                ctx.addIssue({
                    code: 'custom',
                    message: getThroughputIssueMessage(issue),
                    path: ['dataModel', 'containers', index],
                });
            }
        }
        for (const [readIndex, read] of container.reads.entries()) {
            if (!hasReadEvidence(read)) {
                ctx.addIssue({
                    code: 'custom',
                    message: getReadEvidenceMessage(readIndex + 1),
                    path: ['dataModel', 'containers', index, 'reads', readIndex],
                });
            }
        }
    }
});

export const ModelingAdvisorSnapshotSchema = z
    .object({
        // Preserve invalid Data-tab estimates in drafts; recommendation requests enforce their limits and ordering.
        wizard: StoredWizardStateSchema,
        recommendation: z.object({
            status: z.enum(['idle', 'waiting', 'stopped', 'received', 'error']),
            value: PartitionKeyRecommendationSchema.optional(),
            error: z.string().optional(),
        }),
        deployment: SuccessfulDeploymentSchema.optional(),
    })
    .refine(
        (snapshot) => snapshot.recommendation.status !== 'received' || snapshot.recommendation.value !== undefined,
        {
            message: 'A received recommendation requires a result.',
            path: ['recommendation', 'value'],
        },
    )
    .refine(
        ({ deployment, recommendation }) =>
            !deployment ||
            (recommendation.status === 'received' &&
                deployment.input.containers.every((container) =>
                    recommendation.value?.containers.some(
                        (candidate) =>
                            candidate.entity === container.entity && candidate.partitionKey === container.partitionKey,
                    ),
                )),
        { message: 'A deployment requires a matching received recommendation.', path: ['deployment'] },
    );
export type ModelingAdvisorSnapshot = z.infer<typeof ModelingAdvisorSnapshotSchema>;

/** Versioned, human-readable stored project, matching migration's version/name envelope. */
export const ModelingAdvisorProjectSchema = z.object({
    version: z.literal(1),
    name: z.string(),
    state: ModelingAdvisorSnapshotSchema,
});
export type ModelingAdvisorProject = z.infer<typeof ModelingAdvisorProjectSchema>;
