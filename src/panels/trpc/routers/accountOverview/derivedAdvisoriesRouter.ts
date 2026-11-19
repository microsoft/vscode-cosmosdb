/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import { ext } from '../../../../extensionVariables';
import { createLogsOutputReporter } from '../../../accountOverview/logsOutput';
import {
    collectDerivedAdvisories,
    computeDerivedAdvisories,
    type AccountConfigInput,
    type DerivedAdvisoriesResult,
} from '../../../accountOverview/services/advisories';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../../../accountOverview/services/advisories/core/thresholds';
import { DETECTORS } from '../../../accountOverview/services/advisories/registry';
import {
    readRequest,
    recordReadDiagnostic,
    reportUncaughtReadFailure,
    reportUnavailableClient,
} from '../../../accountOverview/services/readDiagnostics';
import { classifyUnavailable, type UnavailableReason } from '../../../accountOverview/services/shared';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: Client-side derived advisories ───────────────────────────────────────
//
// The router prepares the clients and the internal policy, then hands off
// the full fetch-and-evaluate pipeline to `collectDerivedAdvisories`. All that
// remains here is client acquisition and preserving config-only checks when workload collection is unavailable.

type AdvisoryAccountMetadata = Pick<
    AccountOverviewRouterContext['metadata'],
    | 'databaseAccount'
    | 'accountName'
    | 'accountId'
    | 'resourceGroup'
    | 'isServerless'
    | 'getMonitorClient'
    | 'getClient'
    | 'getLogsQueryClient'
> & { subscription: { readonly name: string } };

export async function getDerivedAdvisoriesForAccount(
    metadata: AdvisoryAccountMetadata,
): Promise<DerivedAdvisoriesResult> {
    const account = metadata.databaseAccount as DatabaseAccountGetResults;
    const api = tryGetExperience(account)?.api;
    const accountConfig: AccountConfigInput = {
        accountName: metadata.accountName,
        tags: account.tags,
        subscriptionName: metadata.subscription.name,
        consistencyLevel: account.consistencyPolicy?.defaultConsistencyLevel,
        regionCount: account.locations?.length ?? account.readLocations?.length ?? 0,
        multiRegionWritesEnabled: account.enableMultipleWriteLocations ?? false,
        writeRegionCount: account.writeLocations?.length ?? 0,
        api,
    };
    const advisoryThresholds = DEFAULT_ADVISORY_THRESHOLDS;
    const configOnly = (reason: UnavailableReason): DerivedAdvisoriesResult => ({
        available: true,
        advisories: computeDerivedAdvisories(
            {
                weeklyRuPercents: [],
                hasManualThroughput: false,
                manualThroughput: [],
                partitions: [],
                storage: [],
                indexing: [],
                accountConfig,
            },
            advisoryThresholds,
        ),
        metricSource: {
            available: false,
            failures: DETECTORS.filter(
                ({ rule }) =>
                    rule !== 'ExpensiveConsistency' &&
                    rule !== 'MultiRegionWriteAntipattern' &&
                    rule !== 'CrossPartitionQuery' &&
                    rule !== 'ShardKeyMisalignment' &&
                    rule !== 'UncontrolledIngestion' &&
                    rule !== 'SharedThroughputStarvation',
            ).map(({ rule }) => ({ rule, reason })),
        },
        logSource: { available: false, reason },
        generatedAt: Date.now(),
    });

    if (api !== API.Core) {
        return configOnly('unsupported');
    }

    try {
        const monitorClient = await readRequest('metrics', () => metadata.getMonitorClient());
        const cosmosClient = await readRequest('inventory', () => metadata.getClient());
        if (!monitorClient || !cosmosClient) {
            if (!monitorClient) {
                reportUnavailableClient('metrics');
            }
            if (!cosmosClient) {
                reportUnavailableClient('inventory');
            }
            return configOnly('noData');
        }
        // A failed optional log client must not suppress metric-backed or configuration checks.
        let logsClientFailed = false;
        const logsClient = await readRequest('logs', () => metadata.getLogsQueryClient()).catch((error: unknown) => {
            logsClientFailed = true;
            ext.outputChannel.warn(
                `[Account Overview] Log Analytics client unavailable: ${classifyUnavailable(error)}.`,
            );
            return undefined;
        });
        const outputReporter = createLogsOutputReporter((message) => ext.outputChannel.warn(message));
        const collected = await collectDerivedAdvisories({
            monitorClient,
            cosmosClient,
            logsClient,
            onLogsDiagnostic: (diagnostic) => {
                if (!logsClientFailed || diagnostic.operation !== 'client') {
                    recordReadDiagnostic('logs', diagnostic);
                }
                outputReporter(diagnostic);
            },
            accountId: metadata.accountId,
            resourceGroup: metadata.resourceGroup,
            accountName: metadata.accountName,
            isServerless: metadata.isServerless,
            advisoryThresholds,
            accountConfig,
        });
        return { available: true, ...collected, generatedAt: Date.now() };
    } catch (error) {
        reportUncaughtReadFailure('account', error);
        return configOnly(classifyUnavailable(error));
    }
}

export const derivedAdvisoriesProcedures = {
    getDerivedAdvisories: accountOverviewProcedure.query(({ ctx }: { ctx: AccountOverviewRouterContext }) =>
        getDerivedAdvisoriesForAccount(ctx.metadata),
    ),
};
