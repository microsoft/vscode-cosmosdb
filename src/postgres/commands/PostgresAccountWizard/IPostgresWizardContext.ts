/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from "azure-arm-postgresql/lib/models";
import { IAzureDBWizardContext } from "../../../tree/IAzureDBWizardContext";

export interface IPostgresWizardContext extends IAzureDBWizardContext {

    adminUser?: string;
    adminPassword?: string;

    addFirewall?: boolean;
    publicIp?: string;

    server?: Server;

}
