/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccountInfo } from '../AccountInfo';
import { type ContainerResource, type DatabaseResource, type TriggerResource } from './CosmosDBTypes';

export type CosmosDBTriggerModel = {
    accountInfo: AccountInfo;
    database: DatabaseResource;
    container: ContainerResource;
    trigger: TriggerResource;
};
