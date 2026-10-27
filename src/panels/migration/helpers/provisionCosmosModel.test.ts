/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { CosmosClient } from '@azure/cosmos';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type CosmosModel } from '../cosmosModel';
import {
    armProvisioningOperations,
    provisionCosmosModel,
    sdkProvisioningOperations,
    type CosmosModelProvisioningOperations,
} from './provisionCosmosModel';

const model: CosmosModel = {
    version: 1,
    domain: '',
    capacityMode: 'provisioned',
    containers: [
        {
            name: 'Orders',
            entities: [],
            partitionKeys: [{ path: '/tenant' }, { path: '/id' }],
            maxThroughput: 8000,
            indexingPolicy: {
                includedPaths: [{ path: '/items/*/name/?' }],
                excludedPaths: [{ path: '/secret/*' }],
                compositeIndexes: [[{ path: '/created', order: 'descending' }]],
            },
        },
    ],
};
const expectedDefinition = {
    id: 'Orders',
    partitionKey: { paths: ['/tenant', '/id'], kind: 'MultiHash', version: 2 },
    indexingPolicy: {
        indexingMode: 'consistent',
        automatic: true,
        includedPaths: [{ path: '/items/[]/name/?' }],
        excludedPaths: [{ path: '/secret/*' }],
        compositeIndexes: [[{ path: '/created', order: 'descending' }]],
    },
};
const operations = (): CosmosModelProvisioningOperations => ({ createDatabase: vi.fn(), createContainer: vi.fn() });

describe('shared migration resource pipeline', () => {
    it('validates shared and dedicated allocation using the published JSON Schema', () => {
        const schema = JSON.parse(
            readFileSync(
                new URL(
                    '../../../../skills/cosmosdb-relational-migration/schemas/cosmos-model.schema.json',
                    import.meta.url,
                ),
                'utf8',
            ),
        ) as object;
        const validate = new Ajv2020({ strict: false }).compile(schema);
        const cases: [boolean, (model: CosmosModel) => void][] = [
            [true, () => {}],
            [
                true,
                (definition) => {
                    definition.domain = 'Items';
                    delete definition.databaseMaxThroughput;
                },
            ],
            [
                true,
                (definition) => {
                    delete definition.databaseMaxThroughput;
                    definition.containers[0].throughputMode = 'dedicated';
                    definition.containers[0].maxThroughput = 4000;
                },
            ],
            [
                false,
                (definition) => {
                    delete definition.databaseMaxThroughput;
                },
            ],
            [
                false,
                (definition) => {
                    definition.domain = 'Items';
                },
            ],
            [
                false,
                (definition) => {
                    definition.containers[0].maxThroughput = 4000;
                },
            ],
            [
                false,
                (definition) => {
                    definition.capacityMode = 'serverless';
                },
            ],
            [
                false,
                (definition) => {
                    definition.databaseMaxThroughput = 1500;
                },
            ],
            [
                false,
                (definition) => {
                    delete definition.capacityMode;
                },
            ],
        ];
        for (const [valid, change] of cases) {
            const definition: CosmosModel = {
                version: 1,
                domain: 'all',
                databaseName: 'db',
                capacityMode: 'provisioned',
                databaseMaxThroughput: 4000,
                containers: [
                    {
                        name: 'Items',
                        throughputMode: 'shared',
                        partitionKeys: [{ path: '/pk' }],
                        indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
                        entities: [
                            {
                                name: 'Item',
                                docType: 'item',
                                sourceTable: 'Items',
                                idTemplate: 'item-{Id}',
                                attributes: [
                                    {
                                        target: 'id',
                                        type: 'string',
                                        isId: true,
                                        source: { table: 'Items', column: 'Id', type: 'int' },
                                    },
                                    {
                                        target: 'itemId',
                                        type: 'number',
                                        source: { table: 'Items', column: 'Id', type: 'int' },
                                    },
                                    {
                                        target: 'pk',
                                        type: 'string',
                                        isPartitionKey: true,
                                        source: { table: 'Items', column: 'Pk', type: 'text' },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };
            change(definition);
            expect(validate(definition)).toBe(valid);
        }
    });

    it('rejects shared allocation before any direct resource mutation', async () => {
        for (const shared of [
            { ...model, databaseMaxThroughput: 4000 },
            { ...model, containers: [{ ...model.containers[0], throughputMode: 'shared' as const }] },
        ]) {
            const ops = operations();
            await expect(provisionCosmosModel(shared, 'db', ops)).rejects.toThrow(
                'migration Skill provisioning workflow',
            );
            expect(ops.createDatabase).not.toHaveBeenCalled();
            expect(ops.createContainer).not.toHaveBeenCalled();
        }
    });

    it('preserves creation order, hierarchical keys, sanitized indexes and autoscale throughput', async () => {
        const ops = operations();
        const progress = vi.fn();
        expect(await provisionCosmosModel(model, 'db', ops, { onProgress: progress })).toEqual(['Orders']);
        expect(ops.createDatabase).toHaveBeenCalledWith('db');
        expect(ops.createContainer).toHaveBeenCalledWith('db', expectedDefinition, 8000);
        expect(progress.mock.calls).toEqual([
            ['database', 'db'],
            ['container', 'Orders'],
        ]);
        expect(vi.mocked(ops.createDatabase).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(ops.createContainer).mock.invocationCallOrder[0],
        );
    });

    it('omits provisioned throughput in serverless mode and can target an existing database', async () => {
        const ops = operations();
        await provisionCosmosModel({ ...model, capacityMode: 'serverless' }, 'db', ops, { createDatabase: false });
        expect(ops.createDatabase).not.toHaveBeenCalled();
        expect(ops.createContainer).toHaveBeenCalledWith('db', expectedDefinition, undefined);
    });

    it('keeps the migration default partition key when none was supplied', async () => {
        const ops = operations();
        await provisionCosmosModel({ ...model, containers: [{ name: 'Default', entities: [] }] }, 'db', ops);
        expect(ops.createContainer).toHaveBeenCalledWith(
            'db',
            {
                id: 'Default',
                partitionKey: { paths: ['/id'], kind: 'Hash', version: 2 },
                indexingPolicy: undefined,
            },
            undefined,
        );
    });

    it('stops on cancellation, including cancellation from a progress callback', async () => {
        const token = new vscode.CancellationTokenSource();
        const ops = operations();
        expect(
            await provisionCosmosModel(model, 'db', ops, {
                token: token.token,
                onProgress: (resource) => {
                    if (resource === 'container') token.cancel();
                },
            }),
        ).toBeUndefined();
        expect(ops.createDatabase).toHaveBeenCalledOnce();
        expect(ops.createContainer).not.toHaveBeenCalled();
        token.dispose();
    });

    it('propagates failures and never creates containers after a database failure', async () => {
        const ops = operations();
        vi.mocked(ops.createDatabase).mockRejectedValue(new Error('Access denied'));
        await expect(provisionCosmosModel(model, 'db', ops)).rejects.toThrow('Access denied');
        expect(ops.createContainer).not.toHaveBeenCalled();
    });

    it('preserves the migration ARM requests without ARM-template deployment operations', async () => {
        const client = new CosmosDBManagementClient({ getToken: async () => null }, 'test-subscription');
        const database = vi.spyOn(client.sqlResources, 'createUpdateSqlDatabase').mockResolvedValue({});
        const container = vi.spyOn(client.sqlResources, 'createUpdateSqlContainer').mockResolvedValue({});
        await provisionCosmosModel(
            model,
            'db',
            armProvisioningOperations(client, { resourceGroup: 'group', accountName: 'account' }),
        );
        expect(database).toHaveBeenCalledWith('group', 'account', 'db', { resource: { id: 'db' }, options: {} });
        expect(container).toHaveBeenCalledWith('group', 'account', 'db', 'Orders', {
            resource: expectedDefinition,
            options: { autoscaleSettings: { maxThroughput: 8000 } },
        });
    });

    it('preserves SDK createIfNotExists calls for migration emulator provisioning', async () => {
        const client = new CosmosClient({
            endpoint: 'https://localhost:8081',
            key: Buffer.from('test-key').toString('base64'),
        });
        const database = client.database('db');
        vi.spyOn(client, 'database').mockReturnValue(database);
        const createDatabase = vi
            .spyOn(client.databases, 'createIfNotExists')
            .mockRejectedValue(new Error('database sentinel'));
        const createContainer = vi
            .spyOn(database.containers, 'createIfNotExists')
            .mockRejectedValue(new Error('container sentinel'));
        const ops = sdkProvisioningOperations(client);
        await expect(provisionCosmosModel(model, 'db', ops)).rejects.toThrow('database sentinel');
        expect(createDatabase).toHaveBeenCalledWith({ id: 'db' });
        await expect(provisionCosmosModel(model, 'db', ops, { createDatabase: false })).rejects.toThrow(
            'container sentinel',
        );
        expect(createContainer).toHaveBeenCalledWith({ ...expectedDefinition, maxThroughput: 8000 });
        client.dispose();
    });
});
