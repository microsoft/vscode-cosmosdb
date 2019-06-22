/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementModels as CosmosModels } from '@azure/arm-cosmosdb';
import { IResourceGroupWizardContext } from 'vscode-azureextensionui';
import { Experience } from '../../experiences';

export interface ICosmosDBWizardContext extends IResourceGroupWizardContext {
    /**
     * The name of the new Cosmos DB account
     * This will be defined after `CosmosDBAccountNameStep.prompt` occurs.
     */
    accountName?: string;

    /**
     * The newly created Cosmos DB account
     * This will be defined after `CosmosDBAccountStep.execute` occurs.
     */
    databaseAccount?: CosmosModels.DatabaseAccount;

    /**
     * The defaultExperience to use
     * This will be defined after `CosmosDBAccountApiStep.prompt` occurs.
     */
    defaultExperience?: Experience;
}
