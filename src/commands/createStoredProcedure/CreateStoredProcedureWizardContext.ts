/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Resource, type StoredProcedureDefinition } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AccountInfo } from '../../tree/docdb/AccountInfo';

export interface CreateStoredProcedureWizardContext extends IActionContext {
    accountInfo: AccountInfo;
    databaseId: string;
    containerId: string;
    nodeId: string;

    storedProcedureName?: string;
    storedProcedureBody?: string;

    response?: StoredProcedureDefinition & Resource;
}
