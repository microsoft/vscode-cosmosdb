/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { type DatabaseItem } from '../../mongoClusters/tree/DatabaseItem';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateCollectionWizardContext } from './CreateCollectionWizardContext';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';
import { DocumentDBContainerNameStep } from './DocumentDBContainerNameStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { DocumentDBPartitionKeyStep, HierarchyStep } from './DocumentDBPartitionKeyStep';
import { DocumentDBThroughputStep } from './DocumentDBThroughputStep';
import { CollectionNameStep } from './MongoCollectionNameStep';
import { MongoExecuteStep } from './MongoExecuteStep';

export async function createGraph(context: IActionContext, node?: DocumentDBDatabaseResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBDatabaseResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: ['treeItem.database'],
            unexpectedContextValue: [/experience[.](table|cassandra|core)/i],
        });
    }

    if (!node) {
        return undefined;
    }

    return createDocumentDBContainer(context, node);
}

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

    const isCore = node.experience.api === API.Core;
    const containerTypeName = isCore ? 'container' : 'graph';

    const wizardContext: CreateContainerWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        nodeId: node.id,
        containerTypeName,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: `Create ${containerTypeName}`,
        promptSteps: [
            new DocumentDBContainerNameStep(),
            new DocumentDBPartitionKeyStep(HierarchyStep.First),
            isCore ? new DocumentDBPartitionKeyStep(HierarchyStep.Second) : undefined,
            isCore ? new DocumentDBPartitionKeyStep(HierarchyStep.Third) : undefined,
            new DocumentDBThroughputStep(),
        ].filter((s) => !!s),
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newContainerName = nonNullValue(wizardContext.containerName);
    showConfirmationAsInSettings(`The "${newContainerName}" container has been created.`);
}

export async function createMongoCollection(context: IActionContext, node?: DatabaseItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<DatabaseItem>(context, {
            type: AzExtResourceType.MongoClusters,
            expectedChildContextValue: 'treeItem.database',
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const wizardContext: CreateCollectionWizardContext = {
        ...context,
        credentialsId: node.mongoCluster.id,
        databaseId: node.databaseInfo.name,
        nodeId: node.id,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Create collection'),
        promptSteps: [new CollectionNameStep()],
        executeSteps: [new MongoExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newCollectionName = nonNullValue(wizardContext.newCollectionName);
    showConfirmationAsInSettings(`The "${newCollectionName}" collection has been created.`);
}
