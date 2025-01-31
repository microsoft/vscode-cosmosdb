/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface CreateMongoDatabaseWizardContext extends IActionContext {
    credentialsId: string;
    clusterName: string;
    nodeId: string;

    databaseName?: string;
}
