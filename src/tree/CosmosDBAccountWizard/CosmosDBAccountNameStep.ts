/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { AzureNameStep, ResourceGroupListStep, resourceGroupNamingRules } from 'vscode-azureextensionui';
import { createCosmosDBClient } from '../../utils/azureClients';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountNameStep extends AzureNameStep<ICosmosDBWizardContext> {

    public async prompt(context: ICosmosDBWizardContext): Promise<void> {
        const client = await createCosmosDBClient(context);
        context.newServerName = (await context.ui.showInputBox({
            placeHolder: "Account name",
            prompt: "Provide a Cosmos DB account name",
            validateInput: (name: string) => validateCosmosDBAccountName(name, client)
        })).trim();
        context.valuesToMask.push(context.newServerName);
        context.relatedNameTask = this.generateRelatedName(context, context.newServerName, resourceGroupNamingRules);
    }

    public shouldPrompt(context: ICosmosDBWizardContext): boolean {
        return !context.newServerName;
    }

    protected async isRelatedNameAvailable(context: ICosmosDBWizardContext, name: string): Promise<boolean> {
        return await ResourceGroupListStep.isNameAvailable(context, name);
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
    } else if ((await client.databaseAccounts.checkNameExists(name)).body) {
        return `Account name "${name}" is not available.`;
    } else {
        return undefined;
    }
}
