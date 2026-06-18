/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosContainer, type CosmosModel } from '../cosmosModel';
import { generateSeedScript } from './seedScriptHelpers';

function container(partial: Partial<CosmosContainer> & Pick<CosmosContainer, 'name'>): CosmosContainer {
    return {
        entities: [],
        ...partial,
    };
}

function buildModel(partial: Partial<CosmosModel> = {}): CosmosModel {
    return {
        version: 1,
        domain: 'test',
        containers: [],
        ...partial,
    };
}

describe('generateSeedScript', () => {
    it('emits an emulator usage banner and connect command for emulator targets', () => {
        const script = generateSeedScript(buildModel(), 'mydb', 'emulator');
        expect(script).toContain('<emulator-connection-string>');
        expect(script).toContain("connect '$1'");
        expect(script).toContain('create database mydb');
    });

    it('emits both connection-string and Entra ID usage hints for azure targets', () => {
        const script = generateSeedScript(buildModel(), 'mydb', 'azure');
        expect(script).toContain('Usage (connection string)');
        expect(script).toContain('Usage (Entra ID)');
    });

    it('creates a container with its partition key paths joined by commas', () => {
        const model = buildModel({
            containers: [
                container({
                    name: 'orders',
                    partitionKeys: [{ path: '/tenantId' }, { path: '/orderId' }],
                }),
            ],
        });
        const script = generateSeedScript(model, 'db', 'azure');
        expect(script).toContain('create container orders /tenantId,/orderId --database=db');
    });

    it('defaults the partition key to /id when none is configured', () => {
        const model = buildModel({ containers: [container({ name: 'items' })] });
        const script = generateSeedScript(model, 'db', 'azure');
        expect(script).toContain('create container items /id --database=db');
    });

    it('includes max throughput only for provisioned capacity', () => {
        const model = buildModel({
            capacityMode: 'provisioned',
            containers: [container({ name: 'items', maxThroughput: 4000 })],
        });
        const script = generateSeedScript(model, 'db', 'azure');
        expect(script).toContain('--max_throughput=4000');
    });

    it('omits max throughput for serverless capacity', () => {
        const model = buildModel({
            capacityMode: 'serverless',
            containers: [container({ name: 'items', maxThroughput: 4000 })],
        });
        const script = generateSeedScript(model, 'db', 'azure');
        expect(script).not.toContain('--max_throughput');
    });

    it('embeds an escaped index policy when provided', () => {
        const model = buildModel({
            containers: [
                container({
                    name: 'items',
                    indexingPolicy: { indexingMode: 'consistent', includedPaths: [{ path: '/*' }], excludedPaths: [] },
                }),
            ],
        });
        const script = generateSeedScript(model, 'db', 'azure');
        expect(script).toContain('--index_policy=');
        expect(script).toContain('"indexingMode":"consistent"');
    });

    it('quotes names that contain spaces or special characters', () => {
        const model = buildModel({ containers: [container({ name: 'my orders' })] });
        const script = generateSeedScript(model, 'my db', 'azure');
        expect(script).toContain('"my orders"');
        expect(script).toContain('create database "my db"');
    });

    it('always emits the sample-data read loop and success message', () => {
        const script = generateSeedScript(buildModel(), 'db', 'azure');
        expect(script).toContain('$data = (cat $2)');
        expect(script).toContain('for $entry in $data.sampleData {');
        expect(script).toContain('Seed data inserted successfully.');
    });
});
