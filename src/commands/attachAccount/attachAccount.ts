/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { MongoDBAttachAccountResourceItem } from '../../mongoClusters/tree/workspace/MongoDBAttachAccountResourceItem';
import { CosmosDBAttachAccountResourceItem } from '../../tree/attached/CosmosDBAttachAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { QuickPickType } from '../../utils/pickItem/pickExperience';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';
import { ExperienceStep } from './ExperienceStep';

export async function attachAccount(
    context: IActionContext,
    node?: AzExtTreeItem | CosmosDBAttachAccountResourceItem | MongoDBAttachAccountResourceItem,
): Promise<void> {
    let type: QuickPickType = QuickPickType.ALL;
    let parentId: string = '';

    if (node instanceof AzExtTreeItem) {
        type = QuickPickType.Postgres;
        parentId = node.parent?.id ?? '';
    }

    if (node instanceof CosmosDBAttachAccountResourceItem) {
        type = QuickPickType.Cosmos;
        parentId = node.parentId ?? ext.cosmosDBWorkspaceBranchDataResource.id;
    }

    if (node instanceof MongoDBAttachAccountResourceItem) {
        type = QuickPickType.Mongo;
        parentId = node.parentId ?? ext.mongoClusterWorkspaceBranchDataResource.id;
    }

    const wizardContext: AttachAccountWizardContext = { ...context, quickPickType: type, parentId };

    const wizard = new AzureWizard(wizardContext, {
        title: localize('attachAccountTitle', 'Attach Account'),
        promptSteps: [new ExperienceStep()],
        executeSteps: [],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    showConfirmationAsInSettings(
        localize('showConfirmation.addedWorkspaceConnection', 'New connection has been added to your workspace.'),
    );
}
