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
    configurationFailures,
    classifyPaidContinuousBackup,
    type AccountConfigInput,
    type DerivedAdvisoriesResult,
} from '../../../accountOverview/services/advisories';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../../../accountOverview/services/advisories/core/thresholds';
import { DETECTORS } from '../../../accountOverview/services/advisories/registry';
import { classifyLogsFailure, type LogsDiagnostic } from '../../../accountOverview/services/advisories/fetchers/logsDiagnostics';
import {
    readRequest,
    recordReadFailure,
    reportMetricCoverage,
    reportReadFailure,
    reportUncaughtReadFailure,
    reportUnavailableClient,
} from '../../../accountOverview/services/readDiagnostics';
import { classifyUnavailable, type UnavailableReason } from '../../../accountOverview/services/shared';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';
import { readAccountData } from './readData';

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
> & {
    subscription: {
        readonly name: string;
        readonly subscriptionId: string;
        readonly environment: { readonly resourceManagerEndpointUrl: string };
    };
};

export async function getDerivedAdvisoriesForAccount(
    metadata: AdvisoryAccountMetadata,
): Promise<DerivedAdvisoriesResult> {
    return readAccountData(metadata, 'metrics', async () => {
        const result = await collectForAccount(metadata);
        reportMetricCoverage(result.metricSource);
        return result;
    });
}

async function collectForAccount(metadata: AdvisoryAccountMetadata): Promise<DerivedAdvisoriesResult> {
    const account = metadata.databaseAccount as DatabaseAccountGetResults;
    const fullFidelityChangeFeedEnabled = metadata.databaseAccount.enableAllVersionsAndDeletesChangeFeed;
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
        isServerless: metadata.isServerless,
        perRegionPerPartitionAutoscaleEnabled: account.enablePerRegionPerPartitionAutoscale,
        backupPolicy:
            account.backupPolicy || fullFidelityChangeFeedEnabled !== undefined
                ? {
                      type: account.backupPolicy?.type,
                      migrationState: account.backupPolicy?.migrationState,
                      continuousTier:
                          account.backupPolicy?.type === 'Continuous' &&
                          'continuousModeProperties' in account.backupPolicy
                              ? account.backupPolicy.continuousModeProperties?.tier
                              : undefined,
                      fullFidelityChangeFeedEnabled,
                  }
                : undefined,
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
            failures: [
                ...configurationFailures(accountConfig),
                ...DETECTORS.filter(
                    ({ rule }) =>
                        rule !== 'ExpensiveConsistency' &&
                        rule !== 'MultiRegionWriteAntipattern' &&
                        rule !== 'PaidContinuousBackup' &&
                        rule !== 'PerRegionAutoscaleCandidate' &&
                        !(rule === 'ReservedCapacityCandidate' && metadata.isServerless) &&
                        rule !== 'CrossPartitionQuery' &&
                        rule !== 'ShardKeyMisalignment' &&
                        rule !== 'UncontrolledIngestion' &&
                        rule !== 'SharedThroughputStarvation',
                ).map(({ rule }) => ({ rule, reason })),
            ],
        },
        logSource: { available: false, reason },
        ...(classifyPaidContinuousBackup(accountConfig).rootCause === 'nonprod_paid_continuous_backup' && {
            costSource: {
                available: false,
                failures: [
                    {
                        operation: 'backup',
                        kind: reason === 'unsupported' ? 'unsupported' : reason === 'rbac' ? 'accessDenied' : 'noData',
                    },
                ],
            },
        }),
        generatedAt: Date.now(),
    });

    if (api !== API.Core) {
        return configOnly('unsupported');
    }

    try {
        const monitorClient = await metadata.getMonitorClient();
        const cosmosClient = await readRequest('account', 'acquireClient', () => metadata.getClient());
        if (!monitorClient || !cosmosClient) {
            reportUnavailableClient(!monitorClient ? 'metrics' : 'account');
            return configOnly('noData');
        }
        // A failed optional log client must not suppress metric-backed or configuration checks.
        let logsClientFailure: Pick<LogsDiagnostic, 'kind' | 'reason'> | undefined;
        const logsClient = await metadata.getLogsQueryClient().catch((error: unknown) => {
            reportReadFailure('logs', 'logsClient', error);
            logsClientFailure = classifyLogsFailure(error);
            return undefined;
        });
        const logsOutput = createLogsOutputReporter((message) => ext.outputChannel.warn(message));
        const collected = await collectDerivedAdvisories({
            monitorClient,
            cosmosClient,
            logsClient,
            logsClientFailure,
            onLogsDiagnostic: (diagnostic) => {
                recordReadFailure('logs', diagnostic);
                logsOutput(diagnostic);
            },
            accountId: metadata.accountId,
            resourceGroup: metadata.resourceGroup,
            accountName: metadata.accountName,
            isServerless: metadata.isServerless,
            advisoryThresholds,
            accountConfig,
            costContext: {
                multiRegionWritesEnabled: account.enableMultipleWriteLocations,
                subscriptionId: metadata.subscription.subscriptionId,
                resourceManagerEndpoint: metadata.subscription.environment.resourceManagerEndpointUrl,
                locationNames: (account.locations ?? account.readLocations ?? []).map(
                    (location) => location.locationName ?? '',
                ),
            },
        });
        return { available: true, ...collected, generatedAt: Date.now() };
    } catch (error) {
        reportUncaughtReadFailure('metrics', 'collection', error);
        return configOnly(classifyUnavailable(error));
    }
}

export const derivedAdvisoriesProcedures = {
    getDerivedAdvisories: accountOverviewProcedure.query(({ ctx }: { ctx: AccountOverviewRouterContext }) =>
        getDerivedAdvisoriesForAccount(ctx.metadata),
    ),
};
