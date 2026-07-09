/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { z } from 'zod';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import {
    deriveAccountHealth,
    getInventoryMetrics,
    type InventoryMetricsResult,
} from '../../../accountOverview/services/inventoryMetrics';
import { type ProvisioningState, type TimeRange } from '../../../accountOverview/services/shared';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';
import { readHealthThresholds } from './thresholds';

// ─── Zone: Inventory metrics + per-row health ───────────────────────────────────
//
// Backfills the inventory table with the Azure Monitor columns. The router
// resolves the account's provisioning state / API and the Monitor client, reads
// the configured thresholds, then delegates to `getInventoryMetrics`.

export const inventoryMetricsProcedures = {
    getInventoryMetrics: accountOverviewProcedure
        .input(z.object({ timeRange: z.enum(['1H', '24H', '7D']) }))
        .query(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: { timeRange: TimeRange };
            }): Promise<InventoryMetricsResult> => {
                const { metadata } = ctx;
                const provisioningState = (metadata.databaseAccount as DatabaseAccountGetResults).provisioningState as
                    | ProvisioningState
                    | undefined;
                const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);

                if (experience && experience.api !== API.Core) {
                    return {
                        available: false,
                        reason: 'unsupported',
                        metrics: {},
                        accountHealth: deriveAccountHealth(provisioningState, false),
                        generatedAt: Date.now(),
                    };
                }

                const client = await metadata.getMonitorClient();
                if (!client) {
                    return {
                        available: false,
                        reason: 'noData',
                        metrics: {},
                        accountHealth: deriveAccountHealth(provisioningState, false),
                        generatedAt: Date.now(),
                    };
                }

                return getInventoryMetrics(
                    client,
                    metadata.accountId,
                    input.timeRange,
                    provisioningState,
                    readHealthThresholds(),
                );
            },
        ),
};
