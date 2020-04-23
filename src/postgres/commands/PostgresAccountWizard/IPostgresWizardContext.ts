/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'azure-arm-postgresql/lib/models';
// tslint:disable-next-line: no-implicit-dependencies
import { ResourceGroup } from 'azure-arm-resource/lib/resource/models';
import { IResourceGroupWizardContext } from 'vscode-azureextensionui';
import { SubscriptionTreeItem } from '../../../tree/SubscriptionTreeItem';

export interface IPostgresWizardContext extends IResourceGroupWizardContext {

    newServerName?: string;
    server?: Server;
    resourceGroup?: ResourceGroup;
    subscriptonTreeItem?: SubscriptionTreeItem;

    adminUser?: string;
    adminPassword?: string;

    addFirewall?: boolean;
    publicIp?: string;
    addedCredentials?: boolean;
    addedFirewall?: boolean;

}
