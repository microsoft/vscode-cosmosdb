
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";

export interface IDocDBTreeRoot {
    endpoint: string;
    masterKey: string;
    isEmulator: boolean | undefined;
    getCosmosClient(): CosmosClient;
}
