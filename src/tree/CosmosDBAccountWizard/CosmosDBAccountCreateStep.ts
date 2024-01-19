/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountCreateUpdateParameters } from '@azure/arm-cosmosdb/src/models';
import { LocationListStep } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { Progress } from 'vscode';
import { SERVERLESS_CAPABILITY_NAME } from '../../constants';
import { ext } from '../../extensionVariables';
import { createCosmosDBClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCreateStep extends AzureWizardExecuteStep<ICosmosDBWizardContext> {
    public priority: number = 130;

    public async execute(context: ICosmosDBWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {
        const locationName: string = (await LocationListStep.getLocation(context)).name;
        const defaultExperience = nonNullProp(context, 'defaultExperience');
        const rgName: string = nonNullProp(nonNullProp(context, 'resourceGroup'), 'name');
        const accountName = nonNullProp(context, 'newServerName');

        const client = await createCosmosDBClient(context);
        const creatingMessage: string = localize('creatingCosmosDBAccount', 'Creating Cosmos DB account "{0}" with the "{1}" API... It should be ready in several minutes.', accountName, defaultExperience.shortName);
        ext.outputChannel.appendLog(creatingMessage);
        progress.report({ message: creatingMessage });

        const options: DatabaseAccountCreateUpdateParameters = {
            location: locationName,
            locations: [{ locationName: locationName }],
            kind: defaultExperience.kind,
            capabilities: [],
            databaseAccountOfferType: 'Standard',
            // Note: Setting this tag has no functional effect in the portal, but we'll keep doing it to imitate portal behavior
            tags: { defaultExperience: nonNullProp(defaultExperience, 'tag') },
        };

        if (defaultExperience?.api === 'MongoDB') {
            if (context.mongoVersion !== undefined) {
                options.apiProperties = { serverVersion: context.mongoVersion };
            }
        }

        if (defaultExperience.capability) {
            options.capabilities?.push({ name: defaultExperience.capability });
        }

        if (context.isServerless) {
            options.capabilities?.push({ name: SERVERLESS_CAPABILITY_NAME });
        }

        context.databaseAccount = await client.databaseAccounts.beginCreateOrUpdateAndWait(rgName, accountName, options);
        context.activityResult = context.databaseAccount as AppResource;

        ext.outputChannel.appendLog(`Successfully created Cosmos DB account "${accountName}".`);
    }

    public shouldExecute(context: ICosmosDBWizardContext): boolean {
        return !context.databaseAccount;
    }
}
