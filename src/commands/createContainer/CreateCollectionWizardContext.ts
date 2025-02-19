/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface CreateCollectionWizardContext extends IActionContext {
    credentialsId: string;
    databaseId: string;
    nodeId: string;

    newCollectionName?: string;
}
