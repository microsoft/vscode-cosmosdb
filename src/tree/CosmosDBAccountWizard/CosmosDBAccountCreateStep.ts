/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { DatabaseAccountCreateUpdateParameters, DatabaseAccountsCreateOrUpdateResponse } from '@azure/arm-cosmosdb/src/models';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, createAzureClient } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCreateStep extends AzureWizardExecuteStep<ICosmosDBWizardContext> {
    public priority: number = 130;

    public async execute(wizardContext: ICosmosDBWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {
        const locationName: string = nonNullProp(nonNullProp(wizardContext, 'location'), 'name');
        const defaultExperience = nonNullProp(wizardContext, 'defaultExperience');
        const rgName: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const accountName = nonNullProp(wizardContext, 'newServerName');

        const client: CosmosDBManagementClient = createAzureClient(wizardContext, CosmosDBManagementClient);
        const creatingMessage: string = localize('creatingCosmosDBAccount', 'Creating Cosmos DB account "{0}" with the "{1}" API... It should be ready in several minutes.', accountName, defaultExperience.shortName);
        ext.outputChannel.appendLog(creatingMessage);
        progress.report({ message: creatingMessage });

        const options: DatabaseAccountCreateUpdateParameters = {
            location: locationName,
            locations: [{ locationName: locationName }],
            kind: defaultExperience.kind,
            // Note: Setting this tag has no functional effect in the portal, but we'll keep doing it to imitate portal behavior
            tags: { defaultExperience: nonNullProp(defaultExperience, 'tag') },
        };

        if (wizardContext.defaultExperience?.api === 'MongoDB') {
            options.apiProperties = { serverVersion: '3.6' };
        }

        if (defaultExperience.capability) {
            options.capabilities = [];
            options.capabilities.push({ name: defaultExperience.capability });
        }

        const response: DatabaseAccountsCreateOrUpdateResponse = await client.databaseAccounts.createOrUpdate(rgName, accountName, options);
        wizardContext.databaseAccount = response._response.parsedBody;
        ext.outputChannel.appendLog(`Successfully created Cosmos DB account "${accountName}".`);
    }

    public shouldExecute(wizardContext: ICosmosDBWizardContext): boolean {
        return !wizardContext.databaseAccount;
    }
}
