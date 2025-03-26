/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { type CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { getAccountInfo } from '../../tree/docdb/AccountInfo';
import { DocumentDBAccountAttachedResourceItem } from '../../tree/docdb/DocumentDBAccountAttachedResourceItem';
import { DocumentDBAccountResourceItem } from '../../tree/docdb/DocumentDBAccountResourceItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';
import { type CreateMongoDatabaseWizardContext } from './CreateMongoDatabaseWizardContext';
import { DocumentDBDatabaseNameStep } from './DocumentDBDatabaseNameStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { MongoDatabaseNameStep } from './MongoDatabaseNameStep';
import { MongoExecuteStep } from './MongoExecuteStep';

export async function createAzureDatabase(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | ClusterItemBase,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | ClusterItemBase>(context, {
            type: [AzExtResourceType.AzureCosmosDb, AzExtResourceType.MongoClusters],
        });
    }

    if (!node) {
        return undefined;
    }

    return createDatabase(context, node);
}

export async function createDatabase(
    context: IActionContext,
    node: CosmosDBAccountResourceItemBase | ClusterItemBase,
): Promise<void> {
    if (node instanceof DocumentDBAccountResourceItem || node instanceof DocumentDBAccountAttachedResourceItem) {
        await createDocDBDatabase(context, node);
    }

    if (node instanceof ClusterItemBase) {
        await createMongoDatabase(context, node);
    }
}

async function createDocDBDatabase(
    context: IActionContext,
    node: DocumentDBAccountResourceItem | DocumentDBAccountAttachedResourceItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        accountInfo: await getAccountInfo(node.account),
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new DocumentDBDatabaseNameStep()],
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}

async function createMongoDatabase(context: IActionContext, node: ClusterItemBase): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (!CredentialCache.hasCredentials(node.cluster.id)) {
        throw new Error(
            l10n.t(
                'You are not signed in to the MongoDB Cluster. Please sign in (by expanding the node "{0}") and try again.',
                node.cluster.name,
            ),
        );
    }

    const wizardContext: CreateMongoDatabaseWizardContext = {
        ...context,
        credentialsId: node.cluster.id,
        clusterName: node.cluster.name,
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new MongoDatabaseNameStep()],
        executeSteps: [new MongoExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}
