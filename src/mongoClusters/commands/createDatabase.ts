/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';
import { CredentialCache } from '../CredentialCache';
import { type MongoClusterResourceItem } from '../tree/MongoClusterResourceItem';
import {
    type CreateCollectionWizardContext,
    type CreateDatabaseWizardContext,
} from '../wizards/create/createWizardContexts';
import { DatabaseNameStep } from '../wizards/create/PromptDatabaseNameStep';

export async function createDatabase(context: IActionContext, clusterNode?: MongoClusterResourceItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!clusterNode) {
        throw new Error('No cluster selected.');
    }

    if (!CredentialCache.hasCredentials(clusterNode.mongoCluster.id)) {
        throw new Error(
            localize(
                'mongoClusters.notSignedIn',
                'You are not signed in to the MongoDB Cluster. Please sign in (by expanding the node "{0}") and try again.',
                clusterNode.mongoCluster.name,
            ),
        );
    }

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        credentialsId: clusterNode.mongoCluster.id,
        mongoClusterItem: clusterNode,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: localize('mongoClusters.createDatabase.title', 'Create database'),
        promptSteps: [new DatabaseNameStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();

    const newDatabaseName = nonNullValue(wizardContext.newDatabaseName);

    await clusterNode.createDatabase(context, newDatabaseName);
}
