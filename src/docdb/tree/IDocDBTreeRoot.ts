/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import { type CosmosDBCredential } from '../getCosmosClient';

export interface IDocDBTreeRoot {
    endpoint: string;
    credentials: CosmosDBCredential[];
    isEmulator: boolean | undefined;
    getCosmosClient(): CosmosClient;
}
