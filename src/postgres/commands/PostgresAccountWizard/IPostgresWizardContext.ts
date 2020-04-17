/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'azure-arm-postgresql/lib/models';
import { IResourceGroupWizardContext } from 'vscode-azureextensionui';

export interface IPostgresWizardContext extends IResourceGroupWizardContext {

    newServerName?: string;
    server?: Server;

    adminUser?: string;
    adminPassword?: string;
    addFirewall?: boolean;

}
