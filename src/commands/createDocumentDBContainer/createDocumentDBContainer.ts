/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    PartitionKeyDefinitionVersion,
    PartitionKeyKind,
    type ContainerResponse,
    type RequestOptions,
} from '@azure/cosmos';
import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';
import { PromptContainerNameStep } from './PromptContainerNameStep';
import { HierarchyStep, PromptPartitionKeyStep } from './PromptPartitionKeyStep';
import { PromptThroughputStep } from './PromptThroughputStep';

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
    };

    const wizard = new AzureWizard(wizardContext, {
        title: 'Create container',
        promptSteps: [
            new PromptContainerNameStep(),
            new PromptPartitionKeyStep(HierarchyStep.First),
            new PromptPartitionKeyStep(HierarchyStep.Second),
            new PromptPartitionKeyStep(HierarchyStep.Third),
            new PromptThroughputStep(),
        ],
        showLoadingPrompt: true,
    });

    await wizard.prompt();

    const success = await createContainer(wizardContext, node);

    if (success) {
        const newContainerName = nonNullValue(wizardContext.containerName);
        showConfirmationAsInSettings(`The "${newContainerName}" container has been created.`);
    }
}

async function createContainer(
    context: CreateContainerWizardContext,
    node: DocumentDBDatabaseResourceItem,
): Promise<boolean> {
    const options: RequestOptions = {};
    const { endpoint, credentials, isEmulator } = context.accountInfo;
    const { containerName, partitionKey, throughput, databaseId } = context;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

    if (throughput !== 0) {
        options.offerThroughput = throughput;
    }

    return ext.state.showCreatingChild(node.id, `Creating "${containerName}"...`, async () => {
        // Adding a delay to ensure the "creating child" animation is visible.
        // The `showCreatingChild` function refreshes the parent to show the
        // "creating child" animation and label. Refreshing the parent triggers its
        // `getChildren` method. If the database creation completes too quickly,
        // the dummy node with the animation might be shown alongside the actual
        // database entry, as it will already be available in the database.
        // Note to future maintainers: Do not remove this delay.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const partitionKeyDefinition = {
            paths: partitionKey?.paths ?? [],
            kind:
                (partitionKey?.kind ?? (partitionKey?.paths?.length ?? 0) > 1)
                    ? PartitionKeyKind.MultiHash // Multi-hash partition key if there are sub-partitions
                    : PartitionKeyKind.Hash, // Hash partition key if there is only one partition
            version: PartitionKeyDefinitionVersion.V2,
        };
        const containerDefinition = {
            id: containerName,
            partitionKey: partitionKeyDefinition,
        };
        const container: ContainerResponse = await cosmosClient
            .database(databaseId)
            .containers.create(containerDefinition, options);
        return !!container.resource;
    });
}
