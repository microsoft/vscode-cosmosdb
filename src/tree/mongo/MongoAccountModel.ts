/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosAccountModel } from '../CosmosAccountModel';

export interface MongoAccountModel extends CosmosAccountModel {
    // whaterver needed to be added
    connectionString?: string;
    isServerless?: boolean;
}
