/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import {
    collectDerivedAdvisories,
    type DerivedAdvisoriesResult,
} from '../../../accountOverview/services/derivedAdvisories';
import { classifyUnavailable, type UnavailableReason } from '../../../accountOverview/services/shared';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';
import { readAdvisoryThresholds, readHealthThresholds, readPartitionThresholds } from './thresholds';

// ─── Zone: Client-side derived advisories ───────────────────────────────────────
//
// The router prepares the clients and the configured thresholds, then hands off
// the full fetch-and-evaluate pipeline to `collectDerivedAdvisories`. All that
// remains here is the API guard, client acquisition, and error classification.

export const derivedAdvisoriesProcedures = {
    getDerivedAdvisories: accountOverviewProcedure.query(
        async ({ ctx }: { ctx: AccountOverviewRouterContext }): Promise<DerivedAdvisoriesResult> => {
            const { metadata } = ctx;
            const unavailable = (reason: UnavailableReason): DerivedAdvisoriesResult => ({
                available: false,
                reason,
                advisories: [],
                generatedAt: Date.now(),
            });

            const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);
            if (experience && experience.api !== API.Core) {
                return unavailable('unsupported');
            }

            const monitorClient = await metadata.getMonitorClient();
            const cosmosClient = await metadata.getClient();
            if (!monitorClient || !cosmosClient) {
                return unavailable('noData');
            }

            try {
                const account = metadata.databaseAccount as DatabaseAccountGetResults;
                const advisories = await collectDerivedAdvisories({
                    monitorClient,
                    cosmosClient,
                    accountId: metadata.accountId,
                    resourceGroup: metadata.resourceGroup,
                    accountName: metadata.accountName,
                    isServerless: metadata.isServerless,
                    healthThresholds: readHealthThresholds(),
                    partitionThresholds: readPartitionThresholds(),
                    advisoryThresholds: readAdvisoryThresholds(),
                    accountConfig: {
                        accountName: metadata.accountName,
                        tags: account.tags,
                        subscriptionName: metadata.subscription.name,
                        consistencyLevel: account.consistencyPolicy?.defaultConsistencyLevel,
                        regionCount: account.locations?.length ?? account.readLocations?.length ?? 0,
                        multiRegionWritesEnabled: account.enableMultipleWriteLocations ?? false,
                        writeRegionCount: account.writeLocations?.length ?? 0,
                        // The derived-advisory engine only runs for the Core (SQL) API (guarded above).
                        apiKind: 'core',
                    },
                });

                return { available: true, advisories, generatedAt: Date.now() };
            } catch (error) {
                return unavailable(classifyUnavailable(error));
            }
        },
    ),
};
