/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { METRIC_KEYS, type MetricKey, type MetricSeriesResult } from '../../../accountOverview/metrics/contracts';
import { fetchMetricSeries } from '../../../accountOverview/metrics/hostFetchers';
import { type TimeRange } from '../../../accountOverview/services';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: generic metric series ────────────────────────────────────────────────
//
// One procedure for every Azure Monitor metric the dashboard surfaces. The metric
// key selects the host-side fetcher (`fetchMetricSeries`); the router only acquires
// the Monitor client and returns an explicit `available: false` when it is missing
// so the webview can render an empty-state. All series logic lives behind the
// metric provider registry — adding a metric needs no new procedure.

// Derived from the shared contract so the accepted keys can never drift from `METRIC_KEYS`.
const METRIC_KEY_ENUM = z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]);

export const metricSeriesProcedures = {
    getMetricSeries: accountOverviewProcedure
        .input(
            z.object({
                metric: METRIC_KEY_ENUM,
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
                input: { metric: MetricKey; timeRange: TimeRange; databaseId?: string; containerId?: string };
            }): Promise<MetricSeriesResult> => {
                const { metadata } = ctx;
                const client = await metadata.getMonitorClient();
                if (!client) {
                    return {
                        metric: input.metric,
                        available: false,
                        reason: 'noData',
                        points: [],
                        timeRange: input.timeRange,
                        databaseId: input.databaseId,
                        containerId: input.containerId,
                        generatedAt: Date.now(),
                    };
                }

                return fetchMetricSeries(
                    input.metric,
                    client,
                    metadata.accountId,
                    { databaseId: input.databaseId, containerId: input.containerId },
                    input.timeRange,
                );
            },
        ),
};
