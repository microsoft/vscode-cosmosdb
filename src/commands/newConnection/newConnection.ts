/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { CosmosDBAttachAccountResourceItem } from '../../tree/workspace-view/cosmosdb/CosmosDBAttachAccountResourceItem';
import { MongoDBAttachAccountResourceItem } from '../../tree/workspace-view/documentdb/MongoDBAttachAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { QuickPickType } from '../../utils/pickItem/pickExperience';
import { ExperienceStep } from './ExperienceStep';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export async function newConnection(
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

    const wizardContext: NewConnectionWizardContext = {
        ...context,
        quickPickType: type,
        parentId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('New Connection'),
        promptSteps: [new ExperienceStep()],
        executeSteps: [],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    showConfirmationAsInSettings(l10n.t('New connection has been added to your workspace.'));
}
