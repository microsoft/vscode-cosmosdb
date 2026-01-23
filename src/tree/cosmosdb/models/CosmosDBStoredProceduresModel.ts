/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccountInfo } from '../AccountInfo';
import { type ContainerResource, type DatabaseResource } from './CosmosDBTypes';

export type CosmosDBStoredProceduresModel = {
    accountInfo: AccountInfo;
    database: DatabaseResource;
    container: ContainerResource;
};
