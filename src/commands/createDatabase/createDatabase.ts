/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { createDatabase as createMongoDatabase } from '../../mongoClusters/commands/createDatabase';
import { MongoClusterItemBase } from '../../mongoClusters/tree/MongoClusterItemBase';
import { type MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { type CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';
import { getAccountInfo } from '../../tree/docdb/AccountInfo';
import { DocumentDBAccountAttachedResourceItem } from '../../tree/docdb/DocumentDBAccountAttachedResourceItem';
import { DocumentDBAccountResourceItem } from '../../tree/docdb/DocumentDBAccountResourceItem';
import { MongoAccountResourceItem } from '../../tree/mongo/MongoAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';
import { DocumentDBDatabaseNameStep } from './DocumentDBDatabaseNameStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';

export async function createAzureDatabase(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase | MongoClusterResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase | MongoClusterResourceItem>(context, {
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
    node: CosmosDBAccountResourceItemBase | MongoClusterResourceItem,
): Promise<void> {
    if (node instanceof DocumentDBAccountResourceItem || node instanceof DocumentDBAccountAttachedResourceItem) {
        await createDocDBDatabase(context, node);
    }

    if (node instanceof MongoAccountResourceItem || node instanceof MongoClusterItemBase) {
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
        title: 'Create database',
        promptSteps: [new DocumentDBDatabaseNameStep()],
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(`The "${newDatabaseName}" database has been created.`);
}
