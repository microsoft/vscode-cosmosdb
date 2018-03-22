/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");
import { Capability } from 'azure-arm-cosmosdb/lib/models';
import { AzureWizardStep } from 'vscode-azureextensionui';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';
import { Experience } from '../../constants';

export class CosmosDBAccountStep extends AzureWizardStep<ICosmosDBWizardContext> {
    public async prompt(wizardContext: ICosmosDBWizardContext): Promise<ICosmosDBWizardContext> {
        return wizardContext;
    }

    public async execute(wizardContext: ICosmosDBWizardContext, outputChannel: vscode.OutputChannel): Promise<ICosmosDBWizardContext> {
        const client = new CosmosDBManagementClient(wizardContext.credentials, wizardContext.subscription.subscriptionId);
        outputChannel.appendLine(`Creating Cosmos DB account "${wizardContext.accountName}" with API "${wizardContext.defaultExperience}"...`);
        let options = {
            location: wizardContext.location.name,
            locations: [{ locationName: wizardContext.location.name }],
            kind: wizardContext.kind,
            tags: { defaultExperience: wizardContext.defaultExperience },
            capabilities: []
        };
        if (wizardContext.defaultExperience === Experience.Graph) {
            options.capabilities.push(<Capability>{ name: "EnableGremlin" });
        }
        wizardContext.databaseAccount = await client.databaseAccounts.createOrUpdate(wizardContext.resourceGroup.name, wizardContext.accountName, options);

        // createOrUpdate always returns an empty object - so we have to get the DatabaseAccount separately
        wizardContext.databaseAccount = await client.databaseAccounts.get(wizardContext.resourceGroup.name, wizardContext.accountName);
        outputChannel.appendLine(`Successfully created Cosmos DB account "${wizardContext.accountName}".`);

        return wizardContext;
    }
}
