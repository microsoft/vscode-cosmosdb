/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerDefinition,
    type DatabaseDefinition,
    type Resource,
    type StoredProcedureDefinition,
} from '@azure/cosmos';
import { type AccountInfo } from '../AccountInfo';

export type DocumentDBStoredProcedureModel = {
    accountInfo: AccountInfo;
    database: DatabaseDefinition & Resource;
    container: ContainerDefinition & Resource;
    procedure: StoredProcedureDefinition & Resource;
};
