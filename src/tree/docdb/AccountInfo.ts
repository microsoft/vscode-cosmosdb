/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBCredential } from '../../docdb/getCosmosClient';

export interface AccountInfo {
    credentials: CosmosDBCredential[];
    endpoint: string;
    id: string;
    isEmulator: boolean;
    name: string;
}
