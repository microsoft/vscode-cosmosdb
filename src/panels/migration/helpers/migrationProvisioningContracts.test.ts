/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PromptPiece, type PromptSizing } from '@vscode/prompt-tsx';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type CosmosModel } from '../cosmosModel';
import { Phase3FastConversionPrompt } from '../prompts/Phase3FastConversionPrompt';
import { Phase3Step6IndexingPrompt } from '../prompts/Phase3Step6IndexingPrompt';
import { mergeDomainModels } from './migrationHelpers';
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

vi.mock('@vscode/prompt-tsx', () => ({
    PromptElement: class {
        constructor(public props: unknown) {}
    },
    TextChunk: 'TextChunk',
    UserMessage: 'UserMessage',
}));

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

describe('legacy schema-conversion full-text prompts', () => {
    const props = {
        domainSummary: '',
        cosmosModel: '',
        bestPractices: '',
        indexPathSyntaxRule: '',
        schemaConversionInstructions: '',
        sourceType: 'SQL Server',
        outputRelativePath: '',
    };
    const render = (prompt: { render(state: void, sizing: PromptSizing): PromptPiece }): string =>
        String(prompt.render(undefined, {} as PromptSizing));

    beforeEach(() => {
        vi.stubGlobal('vscpp', (_ctor: unknown, _props: unknown, ...children: unknown[]) => children.join(''));
        vi.stubGlobal('vscppf', { isFragment: true });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('renders a canonical container-level policy in the indexing example', async () => {
        const prompt = render(new Phase3Step6IndexingPrompt(props));
        const start = prompt.indexOf('{\n  "fullTextPolicy"');
        const end = prompt.indexOf('\n\nIMPORTANT:', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const policies = JSON.parse(prompt.slice(start, end)) as Partial<CosmosModel['containers'][number]>;
        expect(policies.fullTextPolicy?.fullTextPaths).toEqual([{ path: '/description', language: 'en-US' }]);
        expect(policies.indexingPolicy).not.toHaveProperty('fullTextPolicy');
        await expect(
            validatePortableMigrationModel(extensionPath, {
                ...model,
                containers: [{ ...model.containers[0], ...policies }],
            }),
        ).resolves.toEqual([]);
    });

    it('omits optional full-text fields from the fast example when search is unused', async () => {
        const prompt = render(new Phase3FastConversionPrompt(props));
        const marker = 'The JSON object MUST match EXACTLY this shape:\n';
        const start = prompt.indexOf(marker) + marker.length;
        const end = prompt.indexOf('\n===SUMMARY===', start);
        expect(prompt).toContain(marker);
        expect(end).toBeGreaterThan(start);
        const example = JSON.parse(prompt.slice(start, end)) as CosmosModel;
        const container = example.containers[0];
        expect(container).not.toHaveProperty('fullTextPolicy');
        expect(container.indexingPolicy).not.toHaveProperty('fullTextPolicy');
        expect(container.indexingPolicy).not.toHaveProperty('fullTextIndexes');
        await expect(
            validatePortableMigrationModel(extensionPath, {
                ...model,
                containers: [{ ...model.containers[0], indexingPolicy: container.indexingPolicy }],
            }),
        ).resolves.toEqual([]);
        expect(prompt).toContain('fullTextPaths: [{ path, language? }]');
        expect(prompt).toContain('omit both optional fields');
    });
});

describe('legacy full-text model merging', () => {
    function domain(domainName: string, fullTextPath?: string) {
        const candidate = structuredClone(model);
        candidate.domain = domainName;
        candidate.containers[0].entities[0].name = domainName;
        candidate.containers[0].entities[0].docType = domainName;
        candidate.containers[0].entities[0].idTemplate = `${domainName.toLowerCase()}-{Id}`;
        if (fullTextPath) {
            candidate.containers[0].fullTextPolicy = {
                defaultLanguage: 'en-US',
                fullTextPaths: [{ path: fullTextPath }],
            };
            candidate.containers[0].indexingPolicy!.fullTextIndexes = [{ path: fullTextPath }];
        }
        return { domainName, model: candidate };
    }

    it('merges distinct paths and indexes and keeps the result canonical', async () => {
        const { merged, conflicts } = mergeDomainModels([
            domain('Orders', '/description'),
            domain('Products', '/title'),
        ]);
        expect(conflicts).toEqual([]);
        const container = merged.containers[0];
        expect(container.fullTextPolicy).toEqual({
            defaultLanguage: 'en-US',
            fullTextPaths: [
                { path: '/description', language: 'en-US' },
                { path: '/title', language: 'en-US' },
            ],
        });
        expect(container.indexingPolicy?.fullTextIndexes).toEqual([{ path: '/description' }, { path: '/title' }]);
        expect(container.indexingPolicy).not.toHaveProperty('fullTextPolicy');
        await expect(validatePortableMigrationModel(extensionPath, { ...model, ...merged })).resolves.toEqual([]);
    });

    it.each([true, false])('retains a policy present on only one domain (first: %s)', async (policyFirst) => {
        const domains = [domain('Orders', '/description'), domain('Products')];
        const { merged, conflicts } = mergeDomainModels(policyFirst ? domains : domains.reverse());
        expect(conflicts).toEqual([]);
        expect(merged.containers[0].fullTextPolicy?.fullTextPaths).toEqual([{ path: '/description' }]);
        expect(merged.containers[0].indexingPolicy?.fullTextIndexes).toEqual([{ path: '/description' }]);
        await expect(validatePortableMigrationModel(extensionPath, { ...model, ...merged })).resolves.toEqual([]);
    });

    it('deduplicates paths with equivalent inherited and explicit languages', async () => {
        const second = domain('Products', '/description');
        second.model.containers[0].fullTextPolicy!.fullTextPaths[0].language = 'en-US';
        const { merged, conflicts } = mergeDomainModels([domain('Orders', '/description'), second]);
        expect(conflicts).toEqual([]);
        expect(merged.containers[0].fullTextPolicy?.fullTextPaths).toHaveLength(1);
        expect(merged.containers[0].indexingPolicy?.fullTextIndexes).toHaveLength(1);
        await expect(validatePortableMigrationModel(extensionPath, { ...model, ...merged })).resolves.toEqual([]);
    });

    it('reports conflicting default languages while preserving distinct path languages', () => {
        const second = domain('Products', '/title');
        second.model.containers[0].fullTextPolicy!.defaultLanguage = 'fr-FR';
        const { merged, conflicts } = mergeDomainModels([domain('Orders', '/description'), second]);
        expect(conflicts).toEqual([expect.stringContaining('full-text default language differs')]);
        expect(merged.containers[0].fullTextPolicy?.fullTextPaths).toContainEqual({
            path: '/title',
            language: 'fr-FR',
        });
    });

    it('reports conflicting effective languages for a shared path', () => {
        const second = domain('Products', '/description');
        second.model.containers[0].fullTextPolicy!.fullTextPaths[0].language = 'fr-FR';
        const { conflicts } = mergeDomainModels([domain('Orders', '/description'), second]);
        expect(conflicts).toEqual([expect.stringContaining('full-text language differs for path "/description"')]);
    });

    it('preserves entity and partition-key conflict reporting', () => {
        const first = domain('Orders');
        const second = domain('Products');
        second.model.containers[0].entities[0].name = 'Orders';
        second.model.containers[0].partitionKeys = [{ path: '/differentKey' }];
        const { conflicts } = mergeDomainModels([first, second]);
        expect(conflicts).toEqual([
            expect.stringContaining('entity "Orders" exists in both'),
            expect.stringContaining('partition key mismatch'),
        ]);
    });
});

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
