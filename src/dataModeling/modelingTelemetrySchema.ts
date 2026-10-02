/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { MAX_CONTAINERS } from '../webviews/cosmosdb/DataModeling/models';

export const ModelingStepSchema = z.enum(['workload', 'container', 'review', 'result', 'deploy']);
export const ModelingMethodSchema = z.enum(['direct', 'bicep', 'terraform', 'sdk']);
export const ModelingControlSchema = z.enum([
    'footerStart',
    'footerNext',
    'footerBack',
    'footerGetRecommendation',
    'footerDeploy',
    'footerStartOver',
    'footerAddContainer',
    'footerRemoveContainer',
    'containerDataTab',
    'containerQueriesTab',
    'containerScaleTab',
    'schemaUpload',
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().min(0).max(1);

export const ModelingUsageSchema = z
    .object({
        scenario: z.enum([
            'none',
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
        ]),
        differsFromDefault: z.boolean(),
        dataChanged: z.boolean(),
        queriesChanged: z.boolean(),
        scaleChanged: z.boolean(),
        everEdited: z.boolean(),
        dataEverEdited: z.boolean(),
        queriesEverEdited: z.boolean(),
        scaleEverEdited: z.boolean(),
        containerCount: count.max(MAX_CONTAINERS),
        propertyCount: count,
        queryCount: count,
        customizedContainerCount: count.max(MAX_CONTAINERS),
        dataViewedCount: count.max(MAX_CONTAINERS),
        queriesViewedCount: count.max(MAX_CONTAINERS),
        scaleViewedCount: count.max(MAX_CONTAINERS),
        dataNeverViewedCount: count.max(MAX_CONTAINERS),
        queriesNeverViewedCount: count.max(MAX_CONTAINERS),
        scaleNeverViewedCount: count.max(MAX_CONTAINERS),
        dataCoverage: ratio,
        queriesCoverage: ratio,
        scaleCoverage: ratio,
    })
    .strict();

/** Only bounded categories and numeric aggregates cross the telemetry bridge. */
export const ModelingTelemetryEventSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('scenarioSelected'),
            scenario: ModelingUsageSchema.shape.scenario.exclude(['none']),
        })
        .strict(),
    z.object({ type: z.literal('control'), control: ModelingControlSchema }).strict(),
    z.object({ type: z.literal('schemaImport'), outcome: z.enum(['success', 'error', 'cancelled']) }).strict(),
    z.object({ type: z.literal('fieldAdded') }).strict(),
    z.object({ type: z.literal('usage'), usage: ModelingUsageSchema }).strict(),
    z.object({ type: z.literal('step'), step: ModelingStepSchema }).strict(),
    z
        .object({
            type: z.literal('sessionChoice'),
            choice: z.enum(['new', 'continued', 'replaced']),
        })
        .strict(),
    z
        .object({
            type: z.literal('recommendationDisplayed'),
            requestId: z.string().uuid().optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal('recommendationClientFailure'),
            requestId: z.string().uuid().optional(),
            errorCategory: z.enum(['save', 'subscription', 'invalidResult']),
        })
        .strict(),
    z
        .object({
            type: z.literal('action'),
            action: z.enum([
                'enterDeploy',
                'returnToEditing',
                'retryRecommendation',
                'startOver',
                'copyCode',
                'selectDeploymentMethod',
                'regenerateCode',
            ]),
            method: ModelingMethodSchema.optional(),
            outcome: z.enum(['success', 'error', 'cancelled']).optional(),
            codeCustomized: z.boolean().optional(),
        })
        .strict(),
    z.object({ type: z.literal('feedback'), vote: z.enum(['up', 'down']) }).strict(),
]);

export type ModelingTelemetryEvent = z.infer<typeof ModelingTelemetryEventSchema>;
export type ModelingUsage = z.infer<typeof ModelingUsageSchema>;
export type ModelingStep = z.infer<typeof ModelingStepSchema>;
export type ModelingSection = 'data' | 'queries' | 'scale';
