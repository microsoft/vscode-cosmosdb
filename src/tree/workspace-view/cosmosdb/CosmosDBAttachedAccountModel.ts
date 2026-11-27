/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CosmosDBAttachedAccountModel = {
    connectionString: string;
    id: string;
    storageId: string;
    isEmulator: boolean;
    name: string;
    tenantId?: string;
};

export function isCosmosDBAttachedAccountModel(account: unknown): account is CosmosDBAttachedAccountModel {
    return (
        typeof account === 'object' &&
        account !== null &&
        'connectionString' in account &&
        typeof account.connectionString === 'string' &&
        'id' in account &&
        typeof account.id === 'string' &&
        'storageId' in account &&
        typeof account.storageId === 'string' &&
        'isEmulator' in account &&
        typeof account.isEmulator === 'boolean' &&
        'name' in account &&
        typeof account.name === 'string'
    );
}
