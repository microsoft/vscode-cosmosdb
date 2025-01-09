/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerDefinition,
    type DatabaseDefinition,
    type Resource,
    type TriggerDefinition,
} from '@azure/cosmos';
import { type AccountInfo } from '../AccountInfo';

export type DocumentDBTriggerModel = {
    accountInfo: AccountInfo;
    database: DatabaseDefinition & Resource;
    container: ContainerDefinition & Resource;
    trigger: TriggerDefinition & Resource;
};
