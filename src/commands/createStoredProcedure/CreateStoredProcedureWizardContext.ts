/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type StoredProcedureResource } from '../../tree/cosmosdb/models/CosmosDBTypes';

export interface CreateStoredProcedureWizardContext extends IActionContext {
    accountInfo: AccountInfo;
    databaseId: string;
    containerId: string;
    nodeId: string;

    storedProcedureName?: string;
    storedProcedureBody?: string;

    response?: StoredProcedureResource;
}
