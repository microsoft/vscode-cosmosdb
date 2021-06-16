/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { IAzureDBWizardContext } from '../IAzureDBWizardContext';

export interface ICosmosDBWizardContext extends IAzureDBWizardContext {

    /**
     * The newly created Cosmos DB account
     * This will be defined after `CosmosDBAccountStep.execute` occurs.
     */
    databaseAccount?: DatabaseAccountGetResults;
    isServerless?: boolean;

}
