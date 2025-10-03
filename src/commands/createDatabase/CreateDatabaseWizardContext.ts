/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';

export interface CreateDatabaseWizardContext extends IActionContext {
    accountInfo: AccountInfo;
    nodeId: string;

    databaseName?: string;
}
