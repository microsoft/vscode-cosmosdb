/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { type AccountInfo } from '../AccountInfo';

export type CosmosDBDatabaseModel = {
    accountInfo: AccountInfo;
    database: DatabaseDefinition & Resource;
};
