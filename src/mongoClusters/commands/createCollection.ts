/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';
import { type DatabaseItem } from '../tree/DatabaseItem';
import { type CreateCollectionWizardContext } from '../wizards/create/createWizardContexts';
import { CollectionNameStep } from '../wizards/create/PromptCollectionNameStep';

export async function createCollection(context: IActionContext, databaseNode?: DatabaseItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!databaseNode) {
        throw new Error('No database selected.');
    }

    const wizardContext: CreateCollectionWizardContext = {
        ...context,
        credentialsId: databaseNode.mongoCluster.id,
        databaseItem: databaseNode,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: localize('mongoClusters.createCollection.title', 'Create collection'),
        promptSteps: [new CollectionNameStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();

    const newCollectionName = nonNullValue(wizardContext.newCollectionName);

    await databaseNode.createCollection(context, newCollectionName);
}
