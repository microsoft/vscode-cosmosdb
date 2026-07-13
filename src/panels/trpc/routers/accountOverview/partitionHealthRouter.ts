/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { z } from 'zod';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import {
    DEFAULT_PARTITION_THRESHOLDS,
    getPartitionHealth,
    type PartitionDistributionMode,
    type PartitionHealthResult,
    type TimeRange,
    type UnavailableReason,
} from '../../../accountOverview/services';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';
import { readPartitionThresholds } from './thresholds';

// ─── Zone: Partition key distribution health ────────────────────────────────────
//
// Physical-partition RU/storage distribution for a single container. The router
// resolves the API/Monitor client and configured thresholds, and builds the
// empty-state shape; `getPartitionHealth` does the fetching and folding.

export const partitionHealthProcedures = {
    getPartitionHealth: accountOverviewProcedure
        .input(
            z.object({
                timeRange: z.enum(['1H', '24H', '7D']),
                databaseId: z.string(),
                containerId: z.string(),
                mode: z.enum(['ru', 'storage']),
            }),
        )
        .query(
            async ({
                ctx,
                input,
            }: {
                ctx: AccountOverviewRouterContext;
                input: {
                    timeRange: TimeRange;
                    databaseId: string;
                    containerId: string;
                    mode: PartitionDistributionMode;
                };
            }): Promise<PartitionHealthResult> => {
                const { metadata } = ctx;
                const unavailable = (reason: UnavailableReason): PartitionHealthResult => ({
                    available: false,
                    reason,
                    mode: input.mode,
                    databaseId: input.databaseId,
                    containerId: input.containerId,
                    tiles: [],
                    skewScore: 0,
                    topPartitionShare: 0,
                    partitionCount: 0,
                    hotThresholdPercent:
                        input.mode === 'ru'
                            ? DEFAULT_PARTITION_THRESHOLDS.hotRuSharePercent
                            : DEFAULT_PARTITION_THRESHOLDS.skewedStorageSharePercent,
                    topN: DEFAULT_PARTITION_THRESHOLDS.topN,
                    generatedAt: Date.now(),
                });

                const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);
                if (experience && experience.api !== API.Core) {
                    return unavailable('unsupported');
                }

                const client = await metadata.getMonitorClient();
                if (!client) {
                    return unavailable('noData');
                }

                return getPartitionHealth(
                    client,
                    metadata.accountId,
                    input.mode,
                    input.timeRange,
                    input.databaseId,
                    input.containerId,
                    readPartitionThresholds(),
                );
            },
        ),
};
