/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosContainer, type CosmosModel } from '../cosmosModel';
import { buildBicepParams, buildBicepTemplate, mergeBicepParams, parseBicepParams } from './bicepGenerator';

function container(partial: Partial<CosmosContainer> & Pick<CosmosContainer, 'name'>): CosmosContainer {
    return { entities: [], ...partial };
}

function buildModel(partial: Partial<CosmosModel> = {}): CosmosModel {
    return { version: 1, domain: 'test', containers: [], ...partial };
}

describe('bicepGenerator', () => {
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
