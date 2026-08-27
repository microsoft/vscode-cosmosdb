/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { describe, expect, it } from 'vitest';
import { getInventoryResult } from './inventory';

/** A CosmosDBManagementClient whose first `sqlResources` read rejects with the given error. */
function throwingCosmosClient(error: unknown): CosmosDBManagementClient {
    const failure = error instanceof Error ? error : Object.assign(new Error('test'), error);
    return {
        sqlResources: {
            listSqlDatabases: () => ({
                [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }),
            }),
        },
    } as unknown as CosmosDBManagementClient;
}

/** A CosmosDBManagementClient that lists no databases (an account with zero containers). */
function emptyCosmosClient(): CosmosDBManagementClient {
    return {
        sqlResources: {
            listSqlDatabases: () => ({
                [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
            }),
        },
    } as unknown as CosmosDBManagementClient;
}

describe('getInventoryResult', () => {
    it('returns available rows for a successful ARM walk', async () => {
        const result = await getInventoryResult(emptyCosmosClient(), 'rg', 'acct', false);
        expect(result.available).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.rows).toEqual([]);
    });

    it('degrades a 403 to an rbac empty-state instead of throwing', async () => {
        const result = await getInventoryResult(throwingCosmosClient({ statusCode: 403 }), 'rg', 'acct', false);
        expect(result.available).toBe(false);
        expect(result.reason).toBe('rbac');
        expect(result.rows).toEqual([]);
    });

    it('degrades any other ARM failure to a noData empty-state', async () => {
        const result = await getInventoryResult(throwingCosmosClient(new Error('boom')), 'rg', 'acct', false);
        expect(result.available).toBe(false);
        expect(result.reason).toBe('noData');
        expect(result.rows).toEqual([]);
    });
});
