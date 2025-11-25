/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type CosmosDBAttachAccountResourceItem } from '../../tree/workspace-view/cosmosdb/CosmosDBAttachAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { ExperienceStep } from './ExperienceStep';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export async function newConnection(context: IActionContext, node?: CosmosDBAttachAccountResourceItem): Promise<void> {
    const parentId: string = node?.parentId ?? ext.cosmosDBWorkspaceBranchDataResource.id;

    const wizardContext: NewConnectionWizardContext = {
        ...context,
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
