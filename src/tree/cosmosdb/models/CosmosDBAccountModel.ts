/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource } from '@azure/arm-resources';
import { type AzureResource } from '@microsoft/vscode-azureresources-api';

export type CosmosDBAccountModel = AzureResource &
    GenericResource & {
        readonly raw: GenericResource; // Resource object from Azure SDK
    };

export function isAzureCosmosDBAccount(account: unknown): account is CosmosDBAccountModel {
    return (
        typeof account === 'object' &&
        account !== null &&
        'type' in account &&
        typeof account.type === 'string' &&
        account.type.toLowerCase() === 'microsoft.documentdb/databaseaccounts' &&
        'subscription' in account &&
        typeof account.subscription === 'object' &&
        account.subscription !== null &&
        'id' in account &&
        typeof account.id === 'string' &&
        'name' in account &&
        typeof account.name === 'string'
    );
}
