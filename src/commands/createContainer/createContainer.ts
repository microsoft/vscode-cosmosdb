/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext, type PromptResult } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { EventEmitter } from 'vscode';
import { API, type Experience } from '../../AzureDBExperiences';
import { maskConnectionTelemetry } from '../../cosmosdb/maskConnectionTelemetry';
import { ext } from '../../extensionVariables';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type CosmosDBDatabaseResourceItem } from '../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { isDataModelerFeatureEnabled } from '../dataModeling/dataModelerFeatureFlag';
import { openDataModelingWizard } from '../dataModeling/openDataModelingWizard';
import { reportDataModelerEntryPoint } from '../dataModeling/reportDataModelerEntryPoint';
import { CosmosDBContainerNameStep } from './CosmosDBContainerNameStep';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { CosmosDBPartitionKeyStep } from './CosmosDBPartitionKeyStep';
import { CosmosDBThroughputStep } from './CosmosDBThroughputStep';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';
import { promptContainerNameOrDataModeler } from './promptContainerNameOrDataModeler';

export async function cosmosDBCreateContainer(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
          ? node
          : // pickAppResource works only with Azure Resources tree
            await pickAppResource<CosmosDBDatabaseResourceItem>(context, {
                type: AzExtResourceType.AzureCosmosDb,
                expectedChildContextValue: 'treeItem.database',
            });

    if (!element) {
        return undefined;
    }

    if (!isTreeElementWithExperience(element)) {
        throw new Error(l10n.t('The selected item does not have experience information.'));
    }

    if (!isTreeElementWithContextValue(element) || !element.contextValue.includes('treeItem.database')) {
        throw new Error(l10n.t('The selected item is not a Cosmos DB database.'));
    }

    const dbNode = element as CosmosDBDatabaseResourceItem;

    await createContainer(context, dbNode.model.accountInfo, dbNode.model.database.id, dbNode.experience);
}

export async function createContainer(
    context: IActionContext,
    accountInfo: AccountInfo,
    databaseId: string,
    experience: Experience,
): Promise<void> {
    context.valuesToMask.push(accountInfo.id, accountInfo.name);
    maskConnectionTelemetry(context, { ...accountInfo, databaseId });

    context.telemetry.properties.experience = experience.api;
    context.telemetry.properties.isServerless = accountInfo.isServerless.toString();
    context.telemetry.properties.isEmulator = accountInfo.isEmulator.toString();

    const wizardContext: CreateContainerWizardContext = {
        ...context,
        accountInfo,
        databaseId,
        experience,
        throughput: undefined,
        maxThroughput: undefined,
    };

    const containerSteps = [
        new CosmosDBPartitionKeyStep('first'),
        new CosmosDBPartitionKeyStep('second'),
        new CosmosDBPartitionKeyStep('third'),
        new CosmosDBThroughputStep(),
    ];
    const modelerEnabled = experience.api === API.Core && ext.isAIFeaturesEnabled && isDataModelerFeatureEnabled();
    const completedPrompt = new EventEmitter<PromptResult>();
    const forwardCompletion = modelerEnabled
        ? context.ui.onDidFinishPrompt((result) => completedPrompt.fire(result))
        : undefined;
    let customPromptActive = false;
    let previousName = '';
    if (modelerEnabled) {
        // AzureWizard tracks Back history and input caching through this event, not just the return from step.prompt.
        // Forward all other members (including the wizard reference) to the original input implementation.
        wizardContext.ui = new Proxy(context.ui, {
            get(target, property, receiver): unknown {
                if (property === 'onDidFinishPrompt') return completedPrompt.event;
                if (property === 'isPrompting' && customPromptActive) return true;
                return Reflect.get(target, property, receiver);
            },
        });
    }
    const nameStep = new CosmosDBContainerNameStep(
        modelerEnabled
            ? async (stepContext) => {
                  customPromptActive = true;
                  try {
                      const choice = await promptContainerNameOrDataModeler(accountInfo, databaseId, previousName);
                      stepContext.telemetry.properties.creationChoice = choice.kind;
                      stepContext.dataModelerSelected = choice.kind === 'dataModeler';
                      if (choice.kind === 'manual') {
                          previousName = choice.name;
                          stepContext.containerName = choice.name;
                          stepContext.valuesToMask.push(choice.name);
                          completedPrompt.fire({ value: choice.name });
                      }
                  } finally {
                      customPromptActive = false;
                  }
              }
            : undefined,
    );
    if (modelerEnabled) {
        nameStep.getSubWizard = async (stepContext) =>
            stepContext.dataModelerSelected ? undefined : { promptSteps: containerSteps.slice() };
    }
    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create container'),
        promptSteps: modelerEnabled ? [nameStep] : [nameStep, ...containerSteps],
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    try {
        await wizard.prompt();
    } finally {
        forwardCompletion?.dispose();
        completedPrompt.dispose();
        wizardContext.ui = context.ui;
    }
    if (wizardContext.dataModelerSelected) {
        await reportDataModelerEntryPoint('createContainer');
        await openDataModelingWizard(context, accountInfo, databaseId);
        return;
    }
    await wizard.execute();

    const newContainerName = nonNullValue(wizardContext.containerName);
    showConfirmationAsInSettings(l10n.t('The "{newContainerName}" container has been created.', { newContainerName }));
}
