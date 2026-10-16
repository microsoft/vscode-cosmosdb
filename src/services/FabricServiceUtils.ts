/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FabricArtifactType } from '../constants';

export type CosmosDbSourceInfo = {
    accountEndpoint: string;
    databaseName: string;
    credentialType: string;
};

export function getArtifactPath(workspaceId: string, artifactId: string, artifactType: FabricArtifactType): string {
    const itemType = artifactType === 'MirroredDatabase' ? 'mirroredDatabases' : 'cosmosDbDatabases';
    return `/v1/workspaces/${workspaceId}/${itemType}/${artifactId}`;
}

export function parseCosmosDbSourceProperties(properties: unknown): CosmosDbSourceInfo {
    const sourceProperties = getRecord(getRecord(properties)?.cosmosDbSourceProperties);
    const serverFqdn = sourceProperties?.serverFqdn;
    const databaseName = sourceProperties?.databaseName;
    const credentialType = sourceProperties?.credentialType;

    if (
        typeof serverFqdn !== 'string' ||
        !serverFqdn.trim() ||
        typeof databaseName !== 'string' ||
        !databaseName ||
        typeof credentialType !== 'string' ||
        !credentialType
    ) {
        throw new Error('The mirrored database does not contain Cosmos DB source connection information.');
    }

    return {
        accountEndpoint: serverFqdn.trim(),
        databaseName,
        credentialType,
    };
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
