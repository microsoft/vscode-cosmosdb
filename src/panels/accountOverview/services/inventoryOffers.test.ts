/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { describe, expect, it, vi } from 'vitest';
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
    it.each(['db-empty', 'db-shared'])(
        'marks a successful database response without throughput incomplete, including %s',
        async (databaseId) => {
            const client = inventoryClient();
            const read = client.sqlResources.getSqlDatabaseThroughput.bind(client.sqlResources);
            vi.spyOn(client.sqlResources, 'getSqlDatabaseThroughput').mockImplementation((...args) =>
                args[2] === databaseId ? Promise.resolve({ resource: {} }) : read(...args),
            );
            const result = await getSqlInventoryDetails(client, 'rg', 'acct', false);
            expect(result.throughputInventoryComplete).toBe(false);
            expect(result.offers.filter((offer) => offer.databaseId === databaseId)).toEqual([]);
            expect(result.offers).toContainEqual(
                expect.objectContaining({ databaseId: 'db-dedicated', containerId: 'dedicated-c', throughputRU: 600 }),
            );
            expect(result.databases).toContain(databaseId);
        },
    );

    it('does not invent throughput for an unresolved provisioned container', async () => {
        const client = inventoryClient();
        const read = client.sqlResources.getSqlContainerThroughput.bind(client.sqlResources);
        vi.spyOn(client.sqlResources, 'getSqlContainerThroughput').mockImplementation((...args) =>
            args[2] === 'db-dedicated' ? Promise.reject(notFound()) : read(...args),
        );
        const result = await getSqlInventoryDetails(client, 'rg', 'acct', false);
        expect(result.throughputInventoryComplete).toBe(false);
        expect(result.offers.filter((offer) => offer.databaseId === 'db-dedicated')).toEqual([]);
        expect(result.rows.find((row) => row.containerId === 'dedicated-c')).toMatchObject({
            throughputMode: 'unknown',
            throughputRU: undefined,
            offerLevel: 'none',
            offerThroughputMode: 'unknown',
        });
    });

    it.each([{}, { resource: {} }, { resource: { autoscaleSettings: {} } }])(
        'does not inherit a shared offer after a successful incomplete container response %j',
        async (response) => {
            const client = inventoryClient();
            const read = client.sqlResources.getSqlContainerThroughput.bind(client.sqlResources);
            vi.spyOn(client.sqlResources, 'getSqlContainerThroughput').mockImplementation((...args) =>
                args[2] === 'db-shared' ? Promise.resolve(response) : read(...args),
            );
            const result = await getSqlInventoryDetails(client, 'rg', 'acct', false);
            expect(result.throughputInventoryComplete).toBe(false);
            expect(result.rows.find((row) => row.containerId === 'shared-c')).toMatchObject({
                throughputMode: 'dedicated',
                throughputRU: undefined,
                offerLevel: 'container',
                offerThroughputMode: 'manual',
            });
            expect(result.offers.filter((offer) => offer.databaseId === 'db-shared')).toEqual([
                expect.objectContaining({ offerLevel: 'database', throughputRU: 1000 }),
            ]);
        },
    );

    it('inherits known shared throughput only when the container offer is absent (404)', async () => {
        const client = inventoryClient();
        const read = vi.spyOn(client.sqlResources, 'getSqlContainerThroughput');
        const result = await getSqlInventoryDetails(client, 'rg', 'acct', false);
        expect(read).toHaveBeenCalledWith('rg', 'acct', 'db-shared', 'shared-c');
        expect(result.throughputInventoryComplete).toBe(true);
        expect(result.rows.find((row) => row.containerId === 'shared-c')).toMatchObject({
            throughputMode: 'shared',
            throughputRU: 1000,
            offerLevel: 'database',
            offerThroughputMode: 'manual',
        });
    });

    it.each([401, 403, 429, 500])(
        'propagates a container-offer HTTP %s instead of inheriting shared throughput',
        async (statusCode) => {
            const client = inventoryClient();
            const error = Object.assign(new Error('Container offer failed'), { statusCode });
            vi.spyOn(client.sqlResources, 'getSqlContainerThroughput').mockRejectedValue(error);
            await expect(getSqlInventoryDetails(client, 'rg', 'acct', false)).rejects.toBe(error);
        },
    );

    it('exposes authoritative offers without double-counting inherited shared children', async () => {
        const inventory = await getSqlInventoryDetails(inventoryClient(), 'rg', 'acct', false);
        expect(inventory.throughputInventoryComplete).toBe(true);
        expect(inventory.databases).toEqual(['db-empty', 'db-shared', 'db-dedicated']);
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
        expect(details.throughputInventoryComplete).toBe(true);
        const rows = await getSqlInventory(client, 'rg', 'acct', true);
        expect(details.offers).toEqual([]);
        expect(details.databases).toEqual(['db']);
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
