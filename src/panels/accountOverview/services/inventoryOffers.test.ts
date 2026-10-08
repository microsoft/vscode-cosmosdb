/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { describe, expect, it } from 'vitest';
import { getSqlInventory, getSqlInventoryDetails } from './inventory';

function notFound(): Error & { statusCode: number; code: string } {
    return Object.assign(new Error('Not found'), { statusCode: 404, code: 'NotFound' });
}

function toAsync<T>(items: readonly T[]): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]: async function* () {
            yield* items;
        },
    };
}

function inventoryClient(): CosmosDBManagementClient {
    return {
        sqlResources: {
            listSqlDatabases: () =>
                toAsync([
                    {
                        name: 'db-empty',
                        resource: { id: 'db-empty' },
                        systemData: { createdAt: '2026-01-01T00:00:00.000Z' },
                    },
                    {
                        name: 'db-shared',
                        resource: { id: 'db-shared' },
                        systemData: { createdAt: '2026-01-02T00:00:00.000Z' },
                    },
                    {
                        name: 'db-dedicated',
                        resource: { id: 'db-dedicated' },
                        systemData: { createdAt: '2026-01-03T00:00:00.000Z' },
                    },
                ]),
            listSqlContainers: (_rg: string, _account: string, databaseId: string) =>
                toAsync(
                    databaseId === 'db-shared'
                        ? [
                              {
                                  name: 'shared-c',
                                  resource: {
                                      id: 'shared-c',
                                      partitionKey: { paths: ['/pk'] },
                                      indexingPolicy: { excludedPaths: [{ path: '/*' }], compositeIndexes: [[]] },
                                  },
                                  systemData: { createdAt: '2026-01-04T00:00:00.000Z' },
                              },
                          ]
                        : databaseId === 'db-dedicated'
                          ? [
                                {
                                    name: 'dedicated-c',
                                    resource: {
                                        id: 'dedicated-c',
                                        partitionKey: { paths: ['/pk'] },
                                        indexingPolicy: { excludedPaths: [], compositeIndexes: [] },
                                    },
                                    systemData: { createdAt: '2026-01-05T00:00:00.000Z' },
                                },
                            ]
                          : [],
                ),
            getSqlDatabaseThroughput: async (_rg: string, _account: string, databaseId: string) => {
                if (databaseId === 'db-empty') {
                    return { resource: { autoscaleSettings: { maxThroughput: 4000 } } };
                }
                if (databaseId === 'db-shared') {
                    return { resource: { throughput: 1000 } };
                }
                throw notFound();
            },
            getSqlContainerThroughput: async (
                _rg: string,
                _account: string,
                databaseId: string,
                containerId: string,
            ) => {
                if (databaseId === 'db-dedicated' && containerId === 'dedicated-c') {
                    return { resource: { throughput: 600 } };
                }
                throw notFound();
            },
        },
    } as unknown as CosmosDBManagementClient;
}

describe('getSqlInventoryDetails', () => {
    it('exposes authoritative offers without double-counting inherited shared children', async () => {
        const inventory = await getSqlInventoryDetails(inventoryClient(), 'rg', 'acct', false);
        expect(inventory.offers).toEqual([
            expect.objectContaining({
                databaseId: 'db-empty',
                offerLevel: 'database',
                throughputMode: 'autoscale',
                offerThroughputMode: 'autoscale',
                throughputRU: 4000,
            }),
            expect.objectContaining({
                databaseId: 'db-shared',
                offerLevel: 'database',
                throughputMode: 'shared',
                offerThroughputMode: 'manual',
                throughputRU: 1000,
            }),
            expect.objectContaining({
                databaseId: 'db-dedicated',
                containerId: 'dedicated-c',
                offerLevel: 'container',
                throughputMode: 'dedicated',
                offerThroughputMode: 'manual',
                throughputRU: 600,
            }),
        ]);

        expect(inventory.rows).toEqual([
            expect.objectContaining({
                databaseId: 'db-shared',
                containerId: 'shared-c',
                throughputMode: 'shared',
                throughputRU: 1000,
                offerLevel: 'database',
                offerThroughputMode: 'manual',
                offerCreatedAt: '2026-01-02T00:00:00.000Z',
            }),
            expect.objectContaining({
                databaseId: 'db-dedicated',
                containerId: 'dedicated-c',
                throughputMode: 'dedicated',
                throughputRU: 600,
                offerLevel: 'container',
                offerThroughputMode: 'manual',
                resourceCreatedAt: '2026-01-05T00:00:00.000Z',
            }),
        ]);
    });

    it('preserves getSqlInventory row compatibility and marks serverless rows as offerless', async () => {
        const client = {
            sqlResources: {
                listSqlDatabases: () =>
                    toAsync([
                        { name: 'db', resource: { id: 'db' }, systemData: { createdAt: '2026-01-01T00:00:00.000Z' } },
                    ]),
                listSqlContainers: () =>
                    toAsync([
                        {
                            name: 'serverless-c',
                            resource: { id: 'serverless-c', partitionKey: { paths: [] }, indexingPolicy: {} },
                            systemData: { createdAt: '2026-01-02T00:00:00.000Z' },
                        },
                    ]),
            },
        } as unknown as CosmosDBManagementClient;

        const details = await getSqlInventoryDetails(client, 'rg', 'acct', true);
        const rows = await getSqlInventory(client, 'rg', 'acct', true);
        expect(details.offers).toEqual([]);
        expect(details.rows[0]).toEqual(
            expect.objectContaining({
                throughputMode: 'serverless',
                throughputRU: undefined,
                offerLevel: 'none',
                offerThroughputMode: 'serverless',
            }),
        );
        expect(rows).toEqual(details.rows);
    });
});
