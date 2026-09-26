/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getArtifactPath, parseCosmosDbSourceProperties } from './FabricServiceUtils';

describe('getArtifactPath', () => {
    it('uses the Cosmos DB databases endpoint for native databases', () => {
        expect(getArtifactPath('workspace-id', 'artifact-id', 'CosmosDBDatabase')).toBe(
            '/v1/workspaces/workspace-id/cosmosDbDatabases/artifact-id',
        );
    });

    it('uses the mirrored databases endpoint for mirrored databases', () => {
        expect(getArtifactPath('workspace-id', 'artifact-id', 'MirroredDatabase')).toBe(
            '/v1/workspaces/workspace-id/mirroredDatabases/artifact-id',
        );
    });
});

describe('parseCosmosDbSourceProperties', () => {
    it('extracts the Cosmos DB source properties from a mirrored database', () => {
        expect(
            parseCosmosDbSourceProperties({
                cosmosDbSourceProperties: {
                    serverFqdn: 'https://account.documents.azure.com:443/',
                    databaseName: 'database-id',
                    credentialType: 'OAuth2',
                },
            }),
        ).toEqual({
            accountEndpoint: 'https://account.documents.azure.com:443/',
            databaseName: 'database-id',
            credentialType: 'OAuth2',
        });
    });

    it.each([
        {},
        { cosmosDbSourceProperties: null },
        { cosmosDbSourceProperties: { serverFqdn: '', databaseName: 'database-id', credentialType: 'OAuth2' } },
        {
            cosmosDbSourceProperties: {
                serverFqdn: 'https://account.documents.azure.com:443/',
                databaseName: '',
                credentialType: 'OAuth2',
            },
        },
        {
            cosmosDbSourceProperties: {
                serverFqdn: 'https://account.documents.azure.com:443/',
                databaseName: 'database-id',
            },
        },
    ])('rejects incomplete Cosmos DB source properties: %j', (properties) => {
        expect(() => parseCosmosDbSourceProperties(properties)).toThrow(
            'The mirrored database does not contain Cosmos DB source connection information.',
        );
    });
});
