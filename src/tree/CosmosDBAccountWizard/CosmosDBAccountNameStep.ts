/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { IAzureUserInput, AzureNameStep, ResourceGroupStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountNameStep extends AzureNameStep<ICosmosDBWizardContext> {
    protected async isRelatedNameAvailable(wizardContext: ICosmosDBWizardContext, name: string): Promise<boolean> {
        return await ResourceGroupStep.isNameAvailable(wizardContext, name);
    }

    public async prompt(wizardContext: ICosmosDBWizardContext, ui: IAzureUserInput): Promise<ICosmosDBWizardContext> {
        const client = new CosmosDBManagementClient(wizardContext.credentials, wizardContext.subscriptionId);
        wizardContext.accountName = (await ui.showInputBox({
            placeHolder: "Account name",
            prompt: "Provide a Cosmos DB account name",
            validateInput: (name: string) => validateCosmosDBAccountName(name, client)
        })).trim();

        wizardContext.relatedNameTask = this.generateRelatedName(wizardContext, wizardContext.accountName, resourceGroupNamingRules);

        return wizardContext;
    }

    public async execute(wizardContext: ICosmosDBWizardContext): Promise<ICosmosDBWizardContext> {
        return wizardContext;
    }
}

async function validateCosmosDBAccountName(name: string, client: CosmosDBManagementClient): Promise<string | undefined> {
    name = name ? name.trim() : '';

    const min = 3;
    const max = 31;
    if (name.length < min || name.length > max) {
        return `The name must be between ${min} and ${max} characters.`;
    } else if (name.match(/[^a-z0-9-]/)) {
        return "The name can only contain lowercase letters, numbers, and the '-' character.";
    } else if (await client.databaseAccounts.checkNameExists(name)) {
        return `Account name "${name}" is not available.`
    } else {
        return undefined;
    }
}
