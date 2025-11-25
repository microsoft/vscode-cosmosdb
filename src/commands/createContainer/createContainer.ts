/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { type CosmosDBDatabaseResourceItem } from '../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { CosmosDBContainerNameStep } from './CosmosDBContainerNameStep';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { CosmosDBPartitionKeyStep } from './CosmosDBPartitionKeyStep';
import { CosmosDBThroughputStep } from './CosmosDBThroughputStep';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export async function cosmosDBCreateContainer(
    context: IActionContext,
    node?: CosmosDBDatabaseResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBDatabaseResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: 'treeItem.database',
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const isCore = node.experience.api === API.Core;

    const wizardContext: CreateContainerWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        experience: node.experience,
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: isCore ? l10n.t('Create container') : l10n.t('Create graph'),
        promptSteps: [
            new CosmosDBContainerNameStep(),
            new CosmosDBPartitionKeyStep('first'),
            isCore ? new CosmosDBPartitionKeyStep('second') : undefined,
            isCore ? new CosmosDBPartitionKeyStep('third') : undefined,
            new CosmosDBThroughputStep(),
        ].filter((s) => !!s),
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newContainerName = nonNullValue(wizardContext.containerName);
    showConfirmationAsInSettings(l10n.t('The "{newContainerName}" container has been created.', { newContainerName }));
}
