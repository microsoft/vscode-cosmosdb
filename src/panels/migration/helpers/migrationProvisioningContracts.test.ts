/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type CosmosModel } from '../cosmosModel';
import {
    buildPortableProvisioningArtifacts,
    getPortableProvisioningCapacity,
    hashPortableMigrationModel,
    normalizeFullTextPolicy,
    normalizeUniqueKeyPolicy,
    validatePortableMigrationModel,
    validatePortableProvisioningVerification,
    validatePortableSampleData,
    type ProvisioningVerificationReport,
} from './migrationProvisioningContracts';

const extensionPath = path.resolve(__dirname, '../../../..');
const model: CosmosModel = {
    version: 1,
    domain: 'all',
    databaseName: 'migration-db',
    capacityMode: 'serverless',
    containers: [
        {
            name: 'Items',
            partitionKeys: [{ path: '/pk' }],
            entities: [
                {
                    name: 'Item',
                    docType: 'item',
                    sourceTable: 'dbo.Items',
                    idTemplate: 'item-{Id}',
                    attributes: [
                        {
                            target: 'id',
                            source: { table: 'Items', column: 'Id', type: 'int' },
                            type: 'string',
                            isId: true,
                        },
                        { target: 'itemId', source: { table: 'Items', column: 'Id', type: 'int' }, type: 'number' },
                        {
                            target: 'pk',
                            source: { table: 'Items', column: 'Pk', type: 'varchar' },
                            type: 'string',
                            isPartitionKey: true,
                        },
                    ],
                },
            ],
            indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
        },
    ],
};
const project: ProjectJson = {
    version: 1,
    name: 'migration-app',
    sourceCode: 'parent',
    phases: {
        discovery: { status: 'complete' },
        targetEnvironment: { type: 'emulator', endpoint: 'https://localhost:8081/' },
    },
};

describe('migrationProvisioningContracts', () => {
    it('rejects malformed models before provisioning iterates containers', async () => {
        const malformedModel = { databaseName: 'broken', containers: undefined } as unknown as CosmosModel;
        await expect(validatePortableMigrationModel(extensionPath, malformedModel)).resolves.toEqual(
            expect.arrayContaining([expect.objectContaining({ path: '$.version' })]),
        );
    });

    it('loads portable validation and generation from the packaged Skill', async () => {
        const sampleData = {
            sampleData: [{ containerName: 'Items', items: [{ id: 'item-1', docType: 'item', itemId: 1, pk: 'p1' }] }],
        };
        await expect(validatePortableSampleData(extensionPath, model, sampleData)).resolves.toEqual([]);
        const artifacts = await buildPortableProvisioningArtifacts(extensionPath, model, sampleData, project);
        expect(artifacts['main.bicep']).toContain("name: 'Items'");
        await expect(hashPortableMigrationModel(extensionPath, model)).resolves.toMatch(/^[0-9a-f]{64}$/u);
    });

    it('shares the emulator-only capacity policy without changing the production model', async () => {
        await expect(
            getPortableProvisioningCapacity(
                extensionPath,
                model,
                model.containers[0],
                project.phases.targetEnvironment,
            ),
        ).resolves.toEqual({ capacityMode: 'provisioned', maxThroughput: 1000 });
        await expect(
            getPortableProvisioningCapacity(extensionPath, model, model.containers[0], { type: 'azure' }),
        ).resolves.toEqual({ capacityMode: 'serverless' });
        expect(model.capacityMode).toBe('serverless');
        expect(model.containers[0].maxThroughput).toBeUndefined();
    });

    it('shares asymmetric Azure capacity compatibility with the portable skill', async () => {
        await expect(
            getPortableProvisioningCapacity(extensionPath, model, model.containers[0], {
                type: 'azure',
                capacityMode: 'provisioned',
                maxThroughput: 2000,
            }),
        ).resolves.toEqual({ capacityMode: 'provisioned', maxThroughput: 2000 });
        const provisioned = structuredClone(model);
        provisioned.capacityMode = 'provisioned';
        provisioned.containers[0].maxThroughput = 4000;
        await expect(
            getPortableProvisioningCapacity(extensionPath, provisioned, provisioned.containers[0], {
                type: 'azure',
                capacityMode: 'serverless',
            }),
        ).rejects.toThrow('cannot satisfy a provisioned-capacity model');
        await expect(
            getPortableProvisioningCapacity(extensionPath, provisioned, provisioned.containers[0], {
                type: 'emulator',
                capacityMode: 'serverless',
            }),
        ).resolves.toEqual({ capacityMode: 'serverless' });
        expect(model.capacityMode).toBe('serverless');
        expect(model.containers[0].maxThroughput).toBeUndefined();
        expect(provisioned.containers[0].maxThroughput).toBe(4000);
    });

    it('preserves full-text configuration across SDK normalization and portable verification', async () => {
        const fullTextModel = structuredClone(model);
        const container = fullTextModel.containers[0];
        container.fullTextPolicy = {
            defaultLanguage: 'en-US',
            fullTextPaths: [{ path: '/title', language: 'de-DE' }, { path: '/description' }],
        };
        container.indexingPolicy!.fullTextIndexes = [{ path: '/description' }, { path: '/title' }];
        const sdkPolicy = normalizeFullTextPolicy(container.fullTextPolicy);
        expect(sdkPolicy).toEqual({
            defaultLanguage: 'en-US',
            fullTextPaths: [
                { path: '/description', language: 'en-US' },
                { path: '/title', language: 'de-DE' },
            ],
        });
        expect(container.fullTextPolicy.fullTextPaths[1].language).toBeUndefined();
        expect(normalizeFullTextPolicy(undefined)).toBeUndefined();
        await expect(validatePortableMigrationModel(extensionPath, fullTextModel)).resolves.toEqual([]);
        const sampleData = {
            sampleData: [{ containerName: 'Items', items: [{ id: 'item-1', docType: 'item', itemId: 1, pk: 'p1' }] }],
        };
        const report: ProvisioningVerificationReport = {
            version: 1,
            verifiedAt: '2026-09-16T00:00:00.000Z',
            modelSha256: await hashPortableMigrationModel(extensionPath, fullTextModel),
            target: { type: 'emulator', endpoint: 'https://localhost:8081/' },
            databaseName: 'migration-db',
            containers: [
                {
                    name: 'Items',
                    partitionKeys: ['/pk'],
                    indexingPolicy: { ...container.indexingPolicy, indexingMode: 'consistent', automatic: true },
                    fullTextPolicy: sdkPolicy,
                    capacityMode: 'provisioned',
                    maxThroughput: 1000,
                },
            ],
            sampleItems: [
                {
                    containerName: 'Items',
                    id: 'item-1',
                    partitionKeyValues: ['p1'],
                    found: true,
                    document: structuredClone(sampleData.sampleData[0].items[0]),
                },
            ],
            failures: [],
        };
        await expect(
            validatePortableProvisioningVerification(extensionPath, fullTextModel, sampleData, project, report),
        ).resolves.toEqual([]);
        const incorrectContent = structuredClone(report);
        incorrectContent.sampleItems[0].document!.itemId = 999;
        await expect(
            validatePortableProvisioningVerification(
                extensionPath,
                fullTextModel,
                sampleData,
                project,
                incorrectContent,
            ),
        ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ path: '$.sampleItems[0].document' })]));
        const incorrectTarget = structuredClone(report);
        incorrectTarget.target.endpoint = 'https://localhost:8082/';
        await expect(
            validatePortableProvisioningVerification(
                extensionPath,
                fullTextModel,
                sampleData,
                project,
                incorrectTarget,
            ),
        ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ path: '$.target.endpoint' })]));
        delete report.containers[0].fullTextPolicy;
        await expect(
            validatePortableProvisioningVerification(extensionPath, fullTextModel, sampleData, project, report),
        ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ path: '$.containers' })]));
    });

    it('preserves unique-key configuration through generation and target verification', async () => {
        const uniqueModel = structuredClone(model);
        const container = uniqueModel.containers[0];
        container.uniqueKeyPolicy = { uniqueKeys: [{ paths: ['/itemId', '/docType'] }] };
        const sdkPolicy = normalizeUniqueKeyPolicy(container.uniqueKeyPolicy);
        expect(sdkPolicy).toEqual({ uniqueKeys: [{ paths: ['/docType', '/itemId'] }] });
        expect(container.uniqueKeyPolicy.uniqueKeys[0].paths).toEqual(['/itemId', '/docType']);
        expect(normalizeUniqueKeyPolicy(undefined)).toBeUndefined();
        expect(normalizeUniqueKeyPolicy({ uniqueKeys: [] })).toBeUndefined();
        await expect(validatePortableMigrationModel(extensionPath, uniqueModel)).resolves.toEqual([]);
        const sampleData = {
            sampleData: [{ containerName: 'Items', items: [{ id: 'item-1', docType: 'item', itemId: 1, pk: 'p1' }] }],
        };
        const artifacts = await buildPortableProvisioningArtifacts(extensionPath, uniqueModel, sampleData, project);
        expect(artifacts['main.bicep']).toContain('uniqueKeyPolicy:');
        expect(artifacts['seed-data.csh']).not.toContain('create container');
        const report: ProvisioningVerificationReport = {
            version: 1,
            verifiedAt: '2026-10-08T00:00:00.000Z',
            modelSha256: await hashPortableMigrationModel(extensionPath, uniqueModel),
            target: { type: 'emulator', endpoint: 'https://localhost:8081/' },
            databaseName: 'migration-db',
            containers: [
                {
                    name: 'Items',
                    partitionKeys: ['/pk'],
                    indexingPolicy: { ...container.indexingPolicy, indexingMode: 'consistent', automatic: true },
                    uniqueKeyPolicy: sdkPolicy,
                    capacityMode: 'provisioned',
                    maxThroughput: 1000,
                },
            ],
            sampleItems: [
                {
                    containerName: 'Items',
                    id: 'item-1',
                    partitionKeyValues: ['p1'],
                    found: true,
                    document: structuredClone(sampleData.sampleData[0].items[0]),
                },
            ],
            failures: [],
        };
        await expect(
            validatePortableProvisioningVerification(extensionPath, uniqueModel, sampleData, project, report),
        ).resolves.toEqual([]);
        delete report.containers[0].uniqueKeyPolicy;
        await expect(
            validatePortableProvisioningVerification(extensionPath, uniqueModel, sampleData, project, report),
        ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ path: '$.containers' })]));
    });

    it('returns path-specific errors for invalid sample data', async () => {
        const errors = await validatePortableSampleData(extensionPath, model, {
            sampleData: [{ containerName: 'Items', items: [{ id: 'wrong', docType: 'item', itemId: 1, pk: 'p1' }] }],
        });
        expect(errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/\.id$/u) })]),
        );
    });
});
