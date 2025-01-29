/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';
import { DocumentDBContainerNameStep } from './DocumentDBContainerNameStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { DocumentDBPartitionKeyStep, HierarchyStep } from './DocumentDBPartitionKeyStep';
import { DocumentDBThroughputStep } from './DocumentDBThroughputStep';

export async function createDocumentDBContainer(
    context: IActionContext,
    node?: DocumentDBDatabaseResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBDatabaseResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: 'treeItem.database',
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const wizardContext: CreateContainerWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: 'Create container',
        promptSteps: [
            new DocumentDBContainerNameStep(),
            new DocumentDBPartitionKeyStep(HierarchyStep.First),
            new DocumentDBPartitionKeyStep(HierarchyStep.Second),
            new DocumentDBPartitionKeyStep(HierarchyStep.Third),
            new DocumentDBThroughputStep(),
        ],
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newContainerName = nonNullValue(wizardContext.containerName);
    showConfirmationAsInSettings(`The "${newContainerName}" container has been created.`);
}
