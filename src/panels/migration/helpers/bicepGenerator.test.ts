/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { type CosmosContainer, type CosmosModel } from '../cosmosModel';
import { buildBicepParams, buildBicepTemplate, mergeBicepParams, parseBicepParams } from './bicepGenerator';

vi.mock('@microsoft/vscode-azext-azureauth', () => ({}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({}));
vi.mock('@microsoft/vscode-azext-utils', () => ({}));
vi.mock('../../../cosmosdb/getCosmosClient', () => ({}));
vi.mock('../../../cosmosdb/utils/azureSessionHelper', () => ({}));
vi.mock('../../../cosmosdb/utils/rbacUtils', () => ({}));
vi.mock('../../../services/MigrationProjectService', () => ({}));
vi.mock('../../../utils/azureClients', () => ({}));
vi.mock('../bestPractices', () => ({}));
vi.mock('./aiHelpers', () => ({}));
vi.mock('./migrationHelpers', () => ({}));
vi.mock('./migrationTelemetry', () => ({}));
vi.mock('../prompts', () => ({}));
vi.mock('../tools/migrationTools', () => ({}));
vi.mock('../../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));

function container(partial: Partial<CosmosContainer> & Pick<CosmosContainer, 'name'>): CosmosContainer {
    return { entities: [], ...partial };
}

function buildModel(partial: Partial<CosmosModel> = {}): CosmosModel {
    return { version: 1, domain: 'test', containers: [], ...partial };
}

describe('bicepGenerator', () => {
    describe('Bicep export regeneration', () => {
        beforeEach(() => vi.clearAllMocks());
        afterEach(() => vi.restoreAllMocks());

        it.each([false, true])('regenerates only missing templates (exists: %s)', async (templateExists) => {
            const { refineBicepParams } = await import('../steps/phase4Provisioning');
            const conversionPath = path.resolve('test-migration', 'phases', '3-schema-conversion');
            const modelPath = path.join(conversionPath, 'model.json');
            const bicepPath = path.resolve('test-migration', 'phases', '4-provisioning', 'main.bicep');
            const paramsPath = path.resolve('test-migration', 'phases', '4-provisioning', 'main.bicepparam');
            const model = buildModel({
                containers: [
                    container({
                        name: 'Items',
                        fullTextPolicy: {
                            defaultLanguage: 'en-US',
                            fullTextPaths: [{ path: '/description' }],
                        },
                        indexingPolicy: {
                            includedPaths: [{ path: '/*' }],
                            excludedPaths: [],
                            fullTextIndexes: [{ path: '/description' }],
                        },
                    }),
                ],
            });
            vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
                if (uri.fsPath === modelPath) return Buffer.from(JSON.stringify(model));
                if (uri.fsPath === paramsPath) return Buffer.from(buildBicepParams({ accountName: 'original' }));
                throw new Error(`Unexpected file read: ${uri.fsPath}`);
            });
            vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async () => {
                if (!templateExists) throw new Error('File not found');
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 };
            });
            const write = vi.spyOn(vscode.workspace.fs, 'writeFile').mockResolvedValue(undefined);
            const context = {
                projectService: {
                    getBicepPath: () => bicepPath,
                    getBicepParamPath: () => paramsPath,
                    getSchemaConversionPath: () => conversionPath,
                },
            } as unknown as Parameters<typeof refineBicepParams>[0];

            await refineBicepParams(context, { location: 'westus' });

            const templates = write.mock.calls
                .filter(([uri]) => uri.fsPath === bicepPath)
                .map(([, content]) => Buffer.from(content).toString('utf8'));
            expect(templates).toEqual(templateExists ? [] : [buildBicepTemplate(model)]);
            const params = write.mock.calls.find(([uri]) => uri.fsPath === paramsPath)?.[1];
            expect(params).toBeDefined();
            expect(Buffer.from(params!).toString('utf8')).toContain("param accountName = 'original'");
            expect(Buffer.from(params!).toString('utf8')).toContain("param location = 'westus'");
        });
    });

    describe('buildBicepTemplate', () => {
        it('targets a resource group and declares the standard parameters', () => {
            const template = buildBicepTemplate(buildModel());
            expect(template).toContain("targetScope = 'resourceGroup'");
            expect(template).toContain('param accountName string');
            expect(template).toContain('param disableLocalAuth bool = true');
        });

        it('defaults the database name when the model omits one', () => {
            expect(buildBicepTemplate(buildModel())).toContain("param databaseName string = 'migration'");
        });

        it('uses the model database name when provided', () => {
            expect(buildBicepTemplate(buildModel({ databaseName: 'shop' }))).toContain(
                "param databaseName string = 'shop'",
            );
        });

        it('enables serverless capability for serverless capacity', () => {
            const template = buildBicepTemplate(buildModel({ capacityMode: 'serverless' }));
            expect(template).toContain("name: 'EnableServerless'");
        });

        it('emits empty capabilities for provisioned capacity', () => {
            const template = buildBicepTemplate(buildModel({ capacityMode: 'provisioned' }));
            expect(template).toContain('capabilities: []');
            expect(template).not.toContain('EnableServerless');
        });

        it('uses Hash partition kind for single-path keys and MultiHash for hierarchical keys', () => {
            const single = buildBicepTemplate(
                buildModel({ containers: [container({ name: 'c', partitionKeys: [{ path: '/pk' }] })] }),
            );
            expect(single).toContain("kind: 'Hash'");

            const hierarchical = buildBicepTemplate(
                buildModel({
                    containers: [container({ name: 'c', partitionKeys: [{ path: '/a' }, { path: '/b' }] })],
                }),
            );
            expect(hierarchical).toContain("kind: 'MultiHash'");
            expect(hierarchical).toContain("paths: ['/a', '/b']");
        });

        it('includes autoscale settings only for provisioned containers with throughput', () => {
            const provisioned = buildBicepTemplate(
                buildModel({
                    capacityMode: 'provisioned',
                    containers: [container({ name: 'c', maxThroughput: 8000 })],
                }),
            );
            expect(provisioned).toContain('maxThroughput: 8000');

            const serverless = buildBicepTemplate(
                buildModel({
                    capacityMode: 'serverless',
                    containers: [container({ name: 'c', maxThroughput: 8000 })],
                }),
            );
            expect(serverless).toContain('options: {}');
            expect(serverless).not.toContain('autoscaleSettings');
        });

        it('renders an indexing policy block when present', () => {
            const template = buildBicepTemplate(
                buildModel({
                    containers: [
                        container({
                            name: 'c',
                            indexingPolicy: {
                                indexingMode: 'consistent',
                                automatic: true,
                                includedPaths: [{ path: '/*' }],
                                excludedPaths: [{ path: '/secret/*' }],
                                compositeIndexes: [
                                    [
                                        { path: '/a', order: 'ascending' },
                                        { path: '/b', order: 'descending' },
                                    ],
                                ],
                            },
                        }),
                    ],
                }),
            );
            expect(template).toContain("indexingMode: 'consistent'");
            expect(template).toContain("path: '/secret/*'");
            expect(template).toContain("order: 'descending'");
        });

        it('preserves full-text policies and indexes with a supported container API', () => {
            const template = buildBicepTemplate(
                buildModel({
                    containers: [
                        container({
                            name: 'Items',
                            fullTextPolicy: {
                                defaultLanguage: 'en-US',
                                fullTextPaths: [{ path: '/description' }, { path: '/title', language: 'fr-FR' }],
                            },
                            indexingPolicy: {
                                includedPaths: [{ path: '/*' }],
                                excludedPaths: [],
                                fullTextIndexes: [{ path: '/description' }, { path: '/title' }],
                            },
                        }),
                    ],
                }),
            );
            expect(template).toContain('Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-10-15');
            expect(template).toContain(
                [
                    '      fullTextPolicy: {',
                    "        defaultLanguage: 'en-US'",
                    '        fullTextPaths: [',
                    '          {',
                    "            path: '/description'",
                    '          }',
                    '          {',
                    "            path: '/title'",
                    "            language: 'fr-FR'",
                    '          }',
                    '        ]',
                    '      }',
                ].join('\n'),
            );
            expect(template).toContain(
                [
                    '        fullTextIndexes: [',
                    '          {',
                    "            path: '/description'",
                    '          }',
                    '          {',
                    "            path: '/title'",
                    '          }',
                    '        ]',
                ].join('\n'),
            );
        });

        it.each([{ fullTextIndexes: undefined }, { fullTextIndexes: [] }])(
            'omits absent policies and empty full-text indexes: %j',
            ({ fullTextIndexes }) => {
                const template = buildBicepTemplate(
                    buildModel({
                        containers: [
                            container({
                                name: 'Items',
                                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [], fullTextIndexes },
                            }),
                        ],
                    }),
                );
                expect(template).not.toContain('fullTextPolicy:');
                expect(template).not.toContain('fullTextIndexes:');
            },
        );

        it('escapes full-text paths and language values', () => {
            const template = buildBicepTemplate(
                buildModel({
                    containers: [
                        container({
                            name: 'Items',
                            fullTextPolicy: {
                                defaultLanguage: "en-'US",
                                fullTextPaths: [{ path: "/description's\\text", language: "fr-'FR" }],
                            },
                            indexingPolicy: {
                                includedPaths: [{ path: '/*' }],
                                excludedPaths: [],
                                fullTextIndexes: [{ path: "/description's\\text" }],
                            },
                        }),
                    ],
                }),
            );
            expect(template).toContain("defaultLanguage: 'en-\\'US'");
            expect(template).toContain("language: 'fr-\\'FR'");
            expect(template.split("path: '/description\\'s\\\\text'")).toHaveLength(3);
        });

        it('preserves container unique-key policies in exported Bicep', () => {
            const template = buildBicepTemplate(
                buildModel({
                    containers: [
                        container({
                            name: 'Items',
                            uniqueKeyPolicy: {
                                uniqueKeys: [{ paths: ['/docType', '/email'] }, { paths: ['/profile/code'] }],
                            },
                        }),
                    ],
                }),
            );
            expect(template).toContain('uniqueKeyPolicy: {');
            expect(template).toContain("paths: ['/docType', '/email']");
            expect(template).toContain("paths: ['/profile/code']");
            expect(buildBicepTemplate(buildModel({ containers: [container({ name: 'Items' })] }))).not.toContain(
                'uniqueKeyPolicy:',
            );
        });

        it('references the data contributor role definition and emits outputs', () => {
            const template = buildBicepTemplate(buildModel());
            expect(template).toContain('00000000-0000-0000-0000-000000000002');
            expect(template).toContain('output accountEndpoint string = account.properties.documentEndpoint');
        });

        it('escapes single quotes in container names', () => {
            const template = buildBicepTemplate(buildModel({ containers: [container({ name: "o'brien" })] }));
            expect(template).toContain("o\\'brien");
        });
    });

    describe('buildBicepParams', () => {
        it('emits TODO placeholders for missing values', () => {
            const params = buildBicepParams();
            expect(params).toContain("using './main.bicep'");
            expect(params).toContain("// TODO: param accountName = '<value>'");
            expect(params).toContain('// TODO: param disableLocalAuth = true');
        });

        it('emits concrete param lines for provided values', () => {
            const params = buildBicepParams({ accountName: 'acct', disableLocalAuth: false });
            expect(params).toContain("param accountName = 'acct'");
            expect(params).toContain('param disableLocalAuth = false');
        });

        it('writes deployment-scope breadcrumbs as comments', () => {
            const params = buildBicepParams({ subscriptionId: 'sub-1', resourceGroup: 'rg-1' });
            expect(params).toContain('az account set --subscription sub-1');
            expect(params).toContain('--resource-group rg-1');
        });
    });

    describe('parseBicepParams', () => {
        it('extracts the owned string and bool params', () => {
            const content = [
                "using './main.bicep'",
                "param accountName = 'acct'",
                "param location = 'westus'",
                'param disableLocalAuth = false',
            ].join('\n');
            expect(parseBicepParams(content)).toEqual({
                accountName: 'acct',
                location: 'westus',
                disableLocalAuth: false,
            });
        });

        it('ignores commented-out and unknown params', () => {
            const content = ["// param accountName = 'ignored'", "param somethingElse = 'x'"].join('\n');
            expect(parseBicepParams(content)).toEqual({});
        });
    });

    describe('mergeBicepParams', () => {
        it('overrides existing values with the partial and keeps the rest', () => {
            const existing = buildBicepParams({ accountName: 'old', location: 'westus' });
            const merged = mergeBicepParams(existing, { accountName: 'new' });
            expect(merged).toContain("param accountName = 'new'");
            expect(merged).toContain("param location = 'westus'");
        });

        it('preserves the previous scope breadcrumb when the partial omits it', () => {
            const existing = buildBicepParams({ accountName: 'acct', subscriptionId: 'sub-9' });
            const merged = mergeBicepParams(existing, { location: 'eastus' });
            expect(merged).toContain('--subscription sub-9');
            expect(merged).toContain("param location = 'eastus'");
        });
    });
});
