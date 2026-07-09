/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import * as l10n from '@vscode/l10n';
import { API, tryGetExperience } from '../../../../AzureDBExperiences';
import { getSqlInventory, type InventoryContainerRow } from '../../../accountOverview/services/inventory';
import { type ProvisioningState } from '../../../accountOverview/services/shared';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewProcedure } from '../../trpc';

// ─── Zone: Account header + static inventory ────────────────────────────────────
//
// Both procedures read only the ARM surfaces — no Azure Monitor calls. The router
// prepares metadata/clients and delegates the `sqlResources` walk to
// `getSqlInventory` in the service.

export const accountInventoryProcedures = {
    getAccountSummary: accountOverviewProcedure.query(async ({ ctx }: { ctx: AccountOverviewRouterContext }) => {
        const { metadata } = ctx;
        // `metadata.databaseAccount` is deep-readonly; every read below is
        // non-mutating, so a cast back to the mutable ARM shape is safe.
        const account = metadata.databaseAccount as DatabaseAccountGetResults;
        const experience = tryGetExperience(account);

        return {
            accountName: metadata.accountName,
            resourceGroup: metadata.resourceGroup,
            subscriptionId: metadata.subscription.subscriptionId,
            subscriptionName: metadata.subscription.name,
            apiType: experience?.shortName ?? l10n.t('Unknown'),
            documentEndpoint: metadata.documentEndpoint,
            isServerless: metadata.isServerless,
            provisioningState: account.provisioningState as ProvisioningState | undefined,
            consistencyLevel: account.consistencyPolicy?.defaultConsistencyLevel,
            freeTierEnabled: account.enableFreeTier ?? false,
            backupPolicyType: account.backupPolicy?.type,
            // `-1` means "no cap"; `undefined` means the property was absent on this api-version (preview-only field).
            totalThroughputLimit: account.capacity?.totalThroughputLimit,
            writeRegions: (account.writeLocations ?? []).map((l) => l.locationName ?? '').filter(Boolean),
            readRegions: (account.readLocations ?? []).map((l) => l.locationName ?? '').filter(Boolean),
            writeRegionCount: account.writeLocations?.length ?? 0,
            readRegionCount: account.readLocations?.length ?? 0,
            lastRefreshedAt: Date.now(),
        };
    }),

    getInventory: accountOverviewProcedure.query(async ({ ctx }: { ctx: AccountOverviewRouterContext }) => {
        const { metadata } = ctx;
        const experience = tryGetExperience(metadata.databaseAccount as DatabaseAccountGetResults);

        // Only the SQL (NoSQL) API is fully supported by this extension today
        // (see `NoSqlAccountResourceItem`); other APIs get an explicit
        // "not supported" empty-state on the webview side instead of rows.
        if (experience && experience.api !== API.Core) {
            return { supported: false as const, rows: [] as InventoryContainerRow[] };
        }

        const client = await metadata.getClient();
        if (!client) {
            throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
        }

        const rows = await getSqlInventory(client, metadata.resourceGroup, metadata.accountName, metadata.isServerless);
        return { supported: true as const, rows };
    }),
};
