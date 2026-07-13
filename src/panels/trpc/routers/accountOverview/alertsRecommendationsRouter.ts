/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { z } from 'zod';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import {
    ALERT_TIME_RANGES,
    type AlertsResult,
    type AlertTimeRange,
    getActiveAlerts,
    getRecommendations,
    type RecommendationsResult,
    type UnavailableReason,
} from '../../../accountOverview/services';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: Active alerts + Advisor recommendations (right rail) ─────────────────
//
// The router resolves the account API and the Alerts Management / Advisor
// clients, and builds the empty-state shapes; `getActiveAlerts` and
// `getRecommendations` own the ARM calls and shaping.

export const alertsRecommendationsProcedures = {
    /**
     * Active Azure Monitor alerts for this account, filtered to the account's
     * `resourceId` and the selected time range. `Fired` alerts only. Non-Core
     * accounts and any Alerts Management error degrade to `available: false`.
     */
    getAlerts: accountOverviewProcedure
        .input(z.object({ timeRange: z.enum(ALERT_TIME_RANGES) }))
        .query(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: { timeRange: AlertTimeRange };
            }): Promise<AlertsResult> => {
                const { metadata } = ctx;
                const unavailable = (reason: UnavailableReason): AlertsResult => ({
                    available: false,
                    reason,
                    alerts: [],
                    criticalCount: 0,
                    warningCount: 0,
                    timeRange: input.timeRange,
                    generatedAt: Date.now(),
                });

                const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);
                if (experience && experience.api !== API.Core) {
                    return unavailable('unsupported');
                }

                const client = await metadata.getAlertsClient();
                if (!client) {
                    return unavailable('noData');
                }

                return getActiveAlerts(
                    client,
                    metadata.subscription.subscriptionId,
                    metadata.accountId,
                    input.timeRange,
                );
            },
        ),

    /**
     * Azure Advisor recommendations for this account. Advisor has no
     * per-resource list endpoint, so a single subscription-wide call is shared
     * across every open dashboard in the same subscription and sharded in the
     * service by `accountId`. Non-Core accounts and any Advisor error degrade to
     * `available: false`.
     */
    getRecommendations: accountOverviewProcedure.query(
        async ({ ctx }: { ctx: AccountOverviewRouterContext }): Promise<RecommendationsResult> => {
            const { metadata } = ctx;
            const unavailable = (reason: UnavailableReason): RecommendationsResult => ({
                available: false,
                reason,
                recommendations: [],
                hasHighImpactPerfCost: false,
                generatedAt: Date.now(),
            });

            const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);
            if (experience && experience.api !== API.Core) {
                return unavailable('unsupported');
            }

            const client = await metadata.getAdvisorClient();
            if (!client) {
                return unavailable('noData');
            }

            return getRecommendations(client, metadata.subscription.subscriptionId, metadata.accountId);
        },
    ),
};
