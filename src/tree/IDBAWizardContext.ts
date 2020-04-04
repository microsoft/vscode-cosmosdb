/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceGroupWizardContext } from 'vscode-azureextensionui';

export interface IDBAWizardContext extends IResourceGroupWizardContext {
    /**
     * The name of the new Cosmos DB account
     * This will be defined after `CosmosDBAccountNameStep.prompt` occurs.
     */
    accountLabel?: String;

    accountType?: String;

}
