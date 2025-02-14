/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosAccountModel } from '../CosmosAccountModel';

export type MongoAccountModel = CosmosAccountModel & {
    connectionString?: string;
    isEmulator?: boolean;
    disableEmulatorSecurity?: boolean;
};
