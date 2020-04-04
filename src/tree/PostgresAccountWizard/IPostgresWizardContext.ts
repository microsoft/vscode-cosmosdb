/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'azure-arm-postgresql/lib/models';
import { IResourceGroupWizardContext } from 'vscode-azureextensionui';

export interface IPostgresWizardContext extends IResourceGroupWizardContext {

    serverName?: string;
    server?: Server;
    resourceGroupName?: String;

    adminUser?: string;
    adminPassword?: string;
    firewall?: boolean;

}
