/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { defaultTrigger } from '../../constants';
import { TriggerFileDescriptor } from '../../cosmosdb/fs/TriggerFileDescriptor';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { CosmosDBTriggersResourceItem } from '../../tree/cosmosdb/CosmosDBTriggersResourceItem';
import { type CosmosDBTriggerModel } from '../../tree/cosmosdb/models/CosmosDBTriggerModel';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { CosmosDBTriggerNameStep } from './CosmosDBTriggerNameStep';
import { CosmosDBTriggerOperationStep } from './CosmosDBTriggerOperationStep';
import { CosmosDBTriggerTypeStep } from './CosmosDBTriggerTypeStep';
import { type CreateTriggerWizardContext } from './CreateTriggerWizardContext';

export async function cosmosDBCreateTrigger(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem | CosmosDBTriggersResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: 'treeItem.container',
            unexpectedContextValue: [/experience[.](table|cassandra|graph)/i], // Only Core supports triggers
        });

        if (!node) {
            return;
        }
    }

    context.telemetry.properties.experience = node.experience.api;

    const nodeId = node instanceof CosmosDBTriggersResourceItem ? node.id : `${node.id}/triggers`;
    const wizardContext: CreateTriggerWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        containerId: node.model.container.id,
        triggerBody: defaultTrigger,
        nodeId,
    };

    const wizard: AzureWizard<CreateTriggerWizardContext> = new AzureWizard(wizardContext, {
        title: l10n.t('Create trigger'),
        promptSteps: [new CosmosDBTriggerNameStep(), new CosmosDBTriggerTypeStep(), new CosmosDBTriggerOperationStep()],
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    if (wizardContext.response) {
        const model: CosmosDBTriggerModel = { ...node.model, trigger: wizardContext.response };
        const triggerId = model.trigger.id;
        const fsNode = new TriggerFileDescriptor(`${nodeId}/${triggerId}`, model, node.experience);
        await ext.fileSystem.showTextDocument(fsNode);
    }
}
