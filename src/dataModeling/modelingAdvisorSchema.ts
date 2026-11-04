/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { MAX_CONTAINERS, MAX_DOCUMENT_SIZE_KB, type ContainerModel } from '../webviews/cosmosdb/DataModeling/models';
import {
    assessContainerThroughput,
    getArrayItemsOrderMessage,
    getThroughputIssueMessage,
    MAX_ARRAY_ITEMS,
    MAX_ATTRIBUTE_COUNT,
    MAX_OPERATIONS_PER_SEC,
} from '../webviews/cosmosdb/DataModeling/workloadLimits';
import { SuccessfulDeploymentSchema } from './deploymentModel';
import { PartitionKeyRecommendationSchema } from './recommendationSchema';

const PropertyRoleSchema = z.enum(['key', 'filter', 'payload']);
// Projects saved before the 2 MB item limit was enforced may contain larger estimates.
// Cap them at the limit instead of failing to load the whole project.
const DocumentSizeKbSchema = z
    .number()
    .nonnegative()
    .transform((size) => Math.min(size, MAX_DOCUMENT_SIZE_KB));
// Projects saved before workload limits were enforced may contain negative, fractional, or huge counts.
// Bring them into the accepted range instead of failing to load the whole project.
const countSchema = (max: number, allowFraction = false) =>
    z.number().transform((value) => Math.min(Math.max(allowFraction ? value : Math.round(value), 0), max));
const OperationsPerSecSchema = countSchema(MAX_OPERATIONS_PER_SEC);
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
        attributeCount: countSchema(MAX_ATTRIBUTE_COUNT),
        avgSizeKb: DocumentSizeKbSchema,
        maxSizeKb: DocumentSizeKbSchema,
    }),
    arrays: z.object({
        hasArrays: z.boolean(),
        avgItems: countSchema(MAX_ARRAY_ITEMS, true),
        maxItems: countSchema(MAX_ARRAY_ITEMS),
        updatePattern: z.enum(['none', 'append', 'patch', 'replace']),
    }),
    reads: z.array(
        z.object({
            id: z.string().min(1),
            pattern: z.string(),
            query: z.string().optional(),
            filters: z.union([z.string(), z.array(z.string())]),
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
        if (container.document.avgSizeKb > container.document.maxSizeKb) {
            ctx.addIssue({
                code: 'custom',
                message: l10n.t('Average document size cannot exceed maximum document size.'),
                path: ['dataModel', 'containers', index, 'document', 'avgSizeKb'],
            });
        }
        if (container.arrays.hasArrays && container.arrays.avgItems > container.arrays.maxItems) {
            ctx.addIssue({
                code: 'custom',
                message: getArrayItemsOrderMessage(),
                path: ['dataModel', 'containers', index, 'arrays', 'avgItems'],
            });
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
    }
});

export const ModelingAdvisorSnapshotSchema = z
    .object({
        // Keep older inconsistent estimates editable; recommendation requests enforce their ordering.
        wizard: StoredWizardStateSchema,
        recommendation: z.object({
            status: z.enum(['idle', 'waiting', 'received', 'error']),
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
