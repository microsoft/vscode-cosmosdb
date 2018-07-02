/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Capability } from 'azure-arm-cosmosdb/lib/models';
import { AzureWizardExecuteStep } from 'vscode-azureextensionui';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';
import { API } from '../../experiences';
import { ext } from '../../extensionVariables';
import { getCosmosDBManagementClient } from '../../docdb/getCosmosDBManagementClient';

export class CosmosDBAccountCreateStep extends AzureWizardExecuteStep<ICosmosDBWizardContext> {
    public async execute(wizardContext: ICosmosDBWizardContext): Promise<ICosmosDBWizardContext> {
        const client = getCosmosDBManagementClient(wizardContext.credentials, wizardContext.subscriptionId);
        ext.outputChannel.appendLine(`Creating Cosmos DB account "${wizardContext.accountName}" with API "${wizardContext.defaultExperience.shortName}"...`);
        let options = {
            location: wizardContext.location.name,
            locations: [{ locationName: wizardContext.location.name }],
            kind: wizardContext.defaultExperience.kind,
            tags: { defaultExperience: wizardContext.defaultExperience.api },
            capabilities: []
        };
        if (wizardContext.defaultExperience.api === API.Graph) {
            options.capabilities.push(<Capability>{ name: "EnableGremlin" });
        }
        wizardContext.databaseAccount = await client.databaseAccounts.createOrUpdate(wizardContext.resourceGroup.name, wizardContext.accountName, options);

        // createOrUpdate always returns an empty object - so we have to get the DatabaseAccount separately
        wizardContext.databaseAccount = await client.databaseAccounts.get(wizardContext.resourceGroup.name, wizardContext.accountName);
        ext.outputChannel.appendLine(`Successfully created Cosmos DB account "${wizardContext.accountName}".`);

        return wizardContext;
    }
}
