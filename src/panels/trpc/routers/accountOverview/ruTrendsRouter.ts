/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { getRuTrends, type RuTrendsResult, type TimeRange } from '../../../accountOverview/services';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: RU utilization trend ─────────────────────────────────────────────────
//
// Account- or container-scoped RU utilization trend. The router acquires the
// Azure Monitor client and returns an explicit `available: false` when it is
// missing so the webview can render an empty-state; all series logic lives in
// `getRuTrends`.

export const ruTrendsProcedures = {
    getRuTrends: accountOverviewProcedure
        .input(
            z.object({
                timeRange: z.enum(['1H', '24H', '7D']),
                databaseId: z.optional(z.string()),
                containerId: z.optional(z.string()),
            }),
        )
        .query(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: { timeRange: TimeRange; databaseId?: string; containerId?: string };
            }): Promise<RuTrendsResult> => {
                const { metadata } = ctx;
                const client = await metadata.getMonitorClient();
                if (!client) {
                    return {
                        available: false,
                        reason: 'noData',
                        points: [],
                        provisionedPercent: 100,
                        timeRange: input.timeRange,
                        databaseId: input.databaseId,
                        containerId: input.containerId,
                        generatedAt: Date.now(),
                    };
                }

                return getRuTrends(client, metadata.accountId, input.timeRange, input.databaseId, input.containerId);
            },
        ),
};
