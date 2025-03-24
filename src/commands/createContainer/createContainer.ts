/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
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
    showConfirmationAsInSettings(l10n.t('The "{newContainerName}" container has been created.', { newContainerName }));
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
        credentialsId: node.cluster.id,
        databaseId: node.databaseInfo.name,
        nodeId: node.id,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: l10n.t('Create collection'),
        promptSteps: [new CollectionNameStep()],
        executeSteps: [new MongoExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newCollectionName = nonNullValue(wizardContext.newCollectionName);
    showConfirmationAsInSettings(
        l10n.t('The "{newCollectionName}" collection has been created.', { newCollectionName }),
    );
}
