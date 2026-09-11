/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PartitionKeyKind } from '@azure/cosmos';
import { describe, expect, it, vi } from 'vitest';
import { createDeploymentModel, missingContainers } from './deploymentTemplate';

vi.mock('@microsoft/vscode-azext-utils', () => ({ AzureWizardPromptStep: class {} }));
vi.mock('../../cosmosdb/withClaimsChallengeHandling', () => ({ withClaimsChallengeHandling: vi.fn() }));

const input = {
    databaseMode: 'existing' as const,
    databaseName: 'db',
    containers: [{ entity: 'Orders', partitionKey: '/tenant, /id' }],
};

describe('modeler migration-model adapter', () => {
    it('adapts selected recommendations to the migration model without inventing throughput settings', () => {
        expect(createDeploymentModel(input)).toEqual({
            version: 1,
            domain: '',
            databaseName: 'db',
            containers: [{ name: 'Orders', entities: [], partitionKeys: [{ path: '/tenant' }, { path: '/id' }] }],
        });
    });

    it.each(['', 'db/name', '..', ' bad ', 'x'.repeat(256)])('rejects invalid database name %j', (databaseName) => {
        expect(() => createDeploymentModel({ ...input, databaseName })).toThrow();
    });

    it.each(['', 'Orders/name', '..', ' Orders ', 'x'.repeat(256)])('rejects invalid container name %j', (entity) => {
        expect(() => createDeploymentModel({ ...input, containers: [{ entity, partitionKey: '/id' }] })).toThrow();
    });

    it.each(['', 'id', '/id,', '/a, /a', '/a,/b,/c,/d', '/a//b'])(
        'rejects invalid partition key %j',
        (partitionKey) => {
            expect(() =>
                createDeploymentModel({ ...input, containers: [{ entity: 'Orders', partitionKey }] }),
            ).toThrow();
        },
    );

    it('rejects empty or duplicate selections', () => {
        expect(() => createDeploymentModel({ ...input, containers: [] })).toThrow();
        expect(() =>
            createDeploymentModel({ ...input, containers: [...input.containers, ...input.containers] }),
        ).toThrow();
    });

    it('skips matching existing containers without changing legacy key versions or policies', () => {
        const existing = {
            id: 'Orders',
            _rid: '',
            _self: '',
            _etag: '',
            _ts: 0,
            defaultTtl: 600,
            partitionKey: { paths: ['/tenant', '/id'], kind: PartitionKeyKind.MultiHash, version: 1 },
        };
        const model = createDeploymentModel(input);
        expect(missingContainers(model, [existing]).containers).toEqual([]);
        expect(existing.defaultTtl).toBe(600);
        expect(model.containers).toHaveLength(1);
        expect(() =>
            missingContainers(model, [{ ...existing, partitionKey: { ...existing.partitionKey, paths: ['/other'] } }]),
        ).toThrow('different partition key');
    });
});
