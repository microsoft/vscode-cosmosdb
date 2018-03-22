/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { IResourceGroupWizardContext, IActionContext } from 'vscode-azureextensionui';
import { Experience, DBAccountKind } from '../../constants';

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
    databaseAccount?: DatabaseAccount;

    /**
     * The defaultExperience to use
     * This will be defined after `CosmosDBAccountApiStep.prompt` occurs.
     */
    defaultExperience?: Experience,

    /**
     * The kind to use
     * This will be defined after `CosmosDBAccountApiStep.prompt` occurs.
     */
    kind?: DBAccountKind,

    /**
     * Action context for the running command
     */
    actionContext?: IActionContext
}
