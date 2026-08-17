/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type ItemDefinition } from '@azure/cosmos';
import * as https from 'node:https';
import { E2E_DATABASE_ID, E2E_DEFAULT_CONTAINER_ID, E2E_EMULATOR_ENDPOINT, E2E_EMULATOR_KEY } from '../setup/emulator';

const client = new CosmosClient({
    endpoint: E2E_EMULATOR_ENDPOINT,
    key: E2E_EMULATOR_KEY,
    connectionPolicy: { enableEndpointDiscovery: false },
    agent: new https.Agent({ rejectUnauthorized: false }),
});

const container = client.database(E2E_DATABASE_ID).container(E2E_DEFAULT_CONTAINER_ID);

export async function createEmulatorDocument<T extends ItemDefinition>(document: T): Promise<T> {
    const response = await container.items.create<T>(document);
    if (!response.resource) throw new Error('Emulator document creation returned no resource');
    return response.resource;
}

export async function readEmulatorDocument<T extends ItemDefinition>(id: string, partitionKey: string): Promise<T> {
    const response = await container.item(id, partitionKey).read<T>();
    if (!response.resource) throw new Error('Emulator document read returned no resource');
    return response.resource;
}

export async function replaceEmulatorDocument<T extends ItemDefinition>(
    id: string,
    partitionKey: string,
    document: T,
): Promise<T> {
    const response = await container.item(id, partitionKey).replace<T>(document);
    if (!response.resource) throw new Error('Emulator document replacement returned no resource');
    return response.resource;
}

export async function deleteEmulatorDocument(id: string, partitionKey: string): Promise<void> {
    try {
        await container.item(id, partitionKey).delete();
    } catch (error) {
        const candidate = error as { code?: number; statusCode?: number };
        if (candidate.code !== 404 && candidate.statusCode !== 404) throw error;
    }
}

export async function emulatorDocumentExists(id: string, partitionKey: string): Promise<boolean> {
    try {
        const response = await container.item(id, partitionKey).read();
        return response.resource !== undefined;
    } catch (error) {
        const candidate = error as { code?: number; statusCode?: number };
        if (candidate.code === 404 || candidate.statusCode === 404) return false;
        throw error;
    }
}
