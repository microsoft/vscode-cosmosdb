/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { type CosmosDBDatabaseResourceItem } from '../../tree/cosmosdb/CosmosDBDatabaseResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { CosmosDBContainerNameStep } from './CosmosDBContainerNameStep';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { CosmosDBPartitionKeyStep } from './CosmosDBPartitionKeyStep';
import { CosmosDBThroughputStep } from './CosmosDBThroughputStep';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

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

    context.telemetry.properties.experience = dbNode.experience.api;

    const isCore = dbNode.experience.api === API.Core;
    const isFabric = dbNode.experience.api === API.FabricNative || dbNode.experience.api === API.FabricMirrored;
    const isFabricNative = dbNode.experience.api === API.FabricNative;
    const isServerless = dbNode.model.accountInfo.isServerless;
    const isSupportHierarchicalPartitionKey = isCore || isFabric;

    context.telemetry.properties.isServerless = isServerless?.toString();
    context.telemetry.properties.isEmulator = dbNode.model.accountInfo.isEmulator?.toString();

    const wizardContext: CreateContainerWizardContext = {
        ...context,
        accountInfo: dbNode.model.accountInfo,
        databaseId: dbNode.model.database.id,
        experience: element.experience,
        nodeId: element.id,
        throughput: isServerless ? 0 : undefined,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create container'),
        promptSteps: [
            new CosmosDBContainerNameStep(),
            new CosmosDBPartitionKeyStep('first'),
            isSupportHierarchicalPartitionKey ? new CosmosDBPartitionKeyStep('second') : undefined,
            isSupportHierarchicalPartitionKey ? new CosmosDBPartitionKeyStep('third') : undefined,
            isServerless || isFabricNative ? undefined : new CosmosDBThroughputStep(),
        ].filter((s) => !!s),
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newContainerName = nonNullValue(wizardContext.containerName);
    showConfirmationAsInSettings(l10n.t('The "{newContainerName}" container has been created.', { newContainerName }));
}
