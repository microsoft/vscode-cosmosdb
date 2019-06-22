/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient, CosmosDBManagementModels as CosmosModels } from '@azure/arm-cosmosdb';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, createAzureClient } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCreateStep extends AzureWizardExecuteStep<ICosmosDBWizardContext> {
    public priority: number = 130;

    public async execute(wizardContext: ICosmosDBWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {
        const client: CosmosDBManagementClient = createAzureClient(wizardContext, CosmosDBManagementClient);
        const creatingMessage: string = `Creating Cosmos DB account "${wizardContext.accountName}" with API "${wizardContext.defaultExperience.shortName}"...`;
        ext.outputChannel.appendLine(creatingMessage);
        progress.report({ message: creatingMessage });
        let options = {
            location: wizardContext.location.name,
            locations: [{ locationName: wizardContext.location.name }],
            kind: wizardContext.defaultExperience.kind,
            // Note: Setting this tag has no functional effect in the portal, but we'll keep doing it to imitate portal behavior
            tags: { defaultExperience: wizardContext.defaultExperience.tag },
            capabilities: []
        };
        if (wizardContext.defaultExperience.capability) {
            options.capabilities.push(<CosmosModels.Capability>{ name: wizardContext.defaultExperience.capability });
        }
        wizardContext.databaseAccount = await client.databaseAccounts.createOrUpdate(wizardContext.resourceGroup.name, wizardContext.accountName, options);

        // createOrUpdate always returns an empty object - so we have to get the DatabaseAccount separately
        wizardContext.databaseAccount = await client.databaseAccounts.get(wizardContext.resourceGroup.name, wizardContext.accountName);
        ext.outputChannel.appendLine(`Successfully created Cosmos DB account "${wizardContext.accountName}".`);
    }

    public shouldExecute(wizardContext: ICosmosDBWizardContext): boolean {
        return !wizardContext.databaseAccount;
    }
}
