/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { READ_SOURCES } from './accessRequirements';
import {
    COST_FAILURE_KINDS,
    DERIVED_ADVISORY_RULES,
    DETECTOR_COVERAGE_STATUSES,
} from './services/advisories/core/types';
import { LOGS_FAILURE_KINDS } from './services/advisories/fetchers/logsDiagnostics';
import { UNAVAILABLE_REASONS } from './services/shared';

export const overviewReadResultSchema = z.object({
    available: z.boolean(),
    diagnostics: z
        .array(
            z.object({
                source: z.enum(READ_SOURCES),
                kind: z.enum(LOGS_FAILURE_KINDS),
                reason: z.enum(UNAVAILABLE_REASONS),
            }),
        )
        .optional(),
});

export type OverviewReadResult = z.infer<typeof overviewReadResultSchema>;

const storageComponentSchema = z.object({ status: z.enum(['available', 'unavailable']) });

export const overviewStorageResultSchema = z.object({
    storage: z.object({ data: storageComponentSchema, index: storageComponentSchema }),
});

const coverageSchema = z.object({ available: z.boolean(), failures: z.array(z.unknown()) });

const detectorCoverageSchema = z
    .object({
        rule: z.enum(DERIVED_ADVISORY_RULES),
        status: z.enum(DETECTOR_COVERAGE_STATUSES),
        evaluatedCount: z.number().int().nonnegative(),
        matchedCount: z.number().int().nonnegative(),
        notApplicableCount: z.number().int().nonnegative(),
        insufficientDataCount: z.number().int().nonnegative(),
        unavailableReasons: z.array(z.enum(UNAVAILABLE_REASONS)),
    })
    .refine((coverage) => coverage.matchedCount <= coverage.evaluatedCount);

export const overviewAdvisoryResultSchema = z.object({
    advisories: z.array(z.unknown()),
    detectorCoverage: z.array(detectorCoverageSchema).optional(),
    metricSource: coverageSchema.optional(),
    logSource: coverageSchema.partial({ failures: true }).optional(),
    costSource: coverageSchema
        .extend({
            failures: z.array(z.object({ kind: z.enum(COST_FAILURE_KINDS) })),
        })
        .optional(),
});

export type OverviewAdvisoryResult = z.infer<typeof overviewAdvisoryResultSchema>;

export const overviewEventSchema = z.object({
    eventName: z.enum([
        'tabViewed',
        'refreshTicked',
        'deepLinkFollowed',
        'drillInOpened',
        'emptyStateShown',
        'recommendationClicked',
        'analyzerSkipped',
    ]),
    properties: z
        .object({
            tab: z.enum(['monitoring', 'databases', 'advisories']).optional(),
            trigger: z.enum(['initial', 'navigation', 'user']).optional(),
            windowSize: z.enum(['1H', '24H', '7D']).optional(),
            target: z.enum(['tree', 'dataExplorer', 'portal', 'partition']).optional(),
            source: z.enum(['advisor', 'derived']).optional(),
            action: z.enum(['expand', 'dismiss']).optional(),
            impact: z.enum(['High', 'Medium', 'Low']).optional(),
            tier: z.literal('logAnalytics').optional(),
            reason: z.enum([...UNAVAILABLE_REASONS, 'error']).optional(),
        })
        .optional(),
});

export type OverviewEvent = z.infer<typeof overviewEventSchema>;

export const overviewErrorSchema = z.object({
    kind: z.enum(['render', 'unhandledError', 'unhandledRejection', 'subscription']),
    operation: z.enum(['navigation', 'feedbackEnabled', 'dataModelerEnabled', 'aiFeaturesEnabled']).optional(),
});

export type OverviewError = z.infer<typeof overviewErrorSchema>;
