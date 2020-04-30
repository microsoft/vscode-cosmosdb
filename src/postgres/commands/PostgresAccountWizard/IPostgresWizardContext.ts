/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICosmosDBWizardContext } from '../../../tree/CosmosDBAccountWizard/ICosmosDBWizardContext';

export interface IPostgresWizardContext extends ICosmosDBWizardContext {

    adminUser?: string;
    adminPassword?: string;

    addFirewall?: boolean;
    publicIp?: string;

}
