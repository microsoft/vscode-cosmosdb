/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { MongoAccountResourceItem } from '../../tree/mongo/MongoAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { CredentialCache } from '../CredentialCache';
import { MongoClusterItemBase } from '../tree/MongoClusterItemBase';
import {
    type CreateCollectionWizardContext,
    type CreateDatabaseWizardContext,
} from '../wizards/create/createWizardContexts';
import { DatabaseNameStep } from '../wizards/create/PromptDatabaseNameStep';

export async function createDatabase(
    context: IActionContext,
    clusterNode?: MongoClusterItemBase | MongoAccountResourceItem,
): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!clusterNode) {
        throw new Error('No cluster selected.');
    }

    let connectionId: string = '';
    let clusterName: string = '';

    // TODO: currently MongoAccountResourceItem does not reuse MongoClusterItemBase, this will be refactored after the v1 to v2 tree migration

    if (clusterNode instanceof MongoAccountResourceItem) {
        context.telemetry.properties.experience = clusterNode.experience?.api;
        connectionId = clusterNode.id;
        clusterName = clusterNode.account.name;
    }

    if (clusterNode instanceof MongoClusterItemBase) {
        context.telemetry.properties.experience = clusterNode.mongoCluster.dbExperience?.api;
        connectionId = clusterNode.mongoCluster.id;
        clusterName = clusterNode.mongoCluster.name;
    }

    if (!CredentialCache.hasCredentials(connectionId)) {
        throw new Error(
            localize(
                'mongoClusters.notSignedIn',
                'You are not signed in to the MongoDB Cluster. Please sign in (by expanding the node "{0}") and try again.',
                clusterName,
            ),
        );
    }

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        credentialsId: connectionId,
        clusterName: clusterName,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: localize('mongoClusters.createDatabase.title', 'Create database'),
        promptSteps: [new DatabaseNameStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();

    const newDatabaseName = nonNullValue(wizardContext.newDatabaseName);

    const success = await clusterNode.createDatabase(context, newDatabaseName);

    if (success) {
        showConfirmationAsInSettings(
            localize('showConfirmation.createdDatabase', 'The "{0}" database has been created.', newDatabaseName),
        );
    }
}
