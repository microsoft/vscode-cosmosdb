/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, type ThroughputSettingsGetResults } from '@azure/arm-cosmosdb';
import { type MetricsListOptionalParams, type Response as MetricsResponse } from '@azure/arm-monitor';
import { vi } from 'vitest';
import { pagedItems } from '../../testFixtures';
import { collectDerivedAdvisories } from '../collect';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../core/thresholds';
import { type AccountConfigInput } from '../core/types';
import { metricResponse, withMetrics } from './metricsFixture';

const noToken = {
    getToken: async () => {
        throw new Error('Network access is forbidden in allocation fixtures.');
    },
};

/** Drive real ARM inventory and advisory collection; only SDK responses are mocked. */
export async function collectAllocations(
    accountConfig: AccountConfigInput,
    pool: ThroughputSettingsGetResults,
    dedicated: Readonly<Record<string, ThroughputSettingsGetResults>>,
    readMetric: (options?: MetricsListOptionalParams) => MetricsResponse = (options) =>
        metricResponse(options?.metricnames ?? '', []),
) {
    const cosmos = new CosmosDBManagementClient(noToken, 'sub');
    const systemData = { createdAt: new Date('2020-01-01T00:00:00Z') };
    vi.spyOn(cosmos.databaseAccounts, 'get').mockResolvedValue({ systemData });
    vi.spyOn(cosmos.sqlResources, 'listSqlDatabases').mockImplementation(() =>
        pagedItems([{ resource: { id: 'db' }, systemData }]),
    );
    vi.spyOn(cosmos.sqlResources, 'listSqlContainers').mockImplementation(() =>
        pagedItems(
            ['a', 'b', ...Object.keys(dedicated)].map((id) => ({
                resource: { id, indexingPolicy: { indexingMode: 'none' } },
                systemData,
            })),
        ),
    );
    vi.spyOn(cosmos.sqlResources, 'getSqlDatabaseThroughput').mockResolvedValue(pool);
    vi.spyOn(cosmos.sqlResources, 'getSqlContainerThroughput').mockImplementation(async (_rg, _acct, _db, id) => {
        const offer = dedicated[id];
        if (!offer) {
            throw Object.assign(new Error('Fixture container inherits its database offer.'), { statusCode: 404 });
        }
        return offer;
    });

    return withMetrics(readMetric, async (monitor) => {
        const activity = vi.spyOn(monitor.activityLogs, 'list').mockImplementation(() => pagedItems([]));
        try {
            return await collectDerivedAdvisories({
                cosmosClient: cosmos,
                monitorClient: monitor,
                accountId:
                    '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/fixture',
                resourceGroup: 'rg',
                accountName: accountConfig.accountName,
                accountConfig,
                isServerless: false,
                advisoryThresholds: DEFAULT_ADVISORY_THRESHOLDS,
            });
        } finally {
            activity.mockRestore();
        }
    });
}
