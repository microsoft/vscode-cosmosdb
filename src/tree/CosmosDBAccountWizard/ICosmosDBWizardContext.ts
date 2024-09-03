/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import  { type ExecuteActivityContext } from '@microsoft/vscode-azext-utils';
import  { type IAzureDBWizardContext } from '../IAzureDBWizardContext';

export interface ICosmosDBWizardContext extends IAzureDBWizardContext, ExecuteActivityContext {
    /**
     * The newly created Cosmos DB account
     * This will be defined after `CosmosDBAccountStep.execute` occurs.
     */
    databaseAccount?: DatabaseAccountGetResults;
    isServerless?: boolean;

    mongoVersion?: string;
}
