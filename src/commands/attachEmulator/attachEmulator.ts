/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { platform } from 'os';
import { ext } from '../../extensionVariables';
import { CosmosDBAttachEmulatorResourceItem } from '../../tree/attached/CosmosDBAttachEmulatorResourceItem';
import { localize } from '../../utils/localize';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptExperienceStep } from './PromptExperienceStep';
import { PromptPortStep } from './PromptPortStep';

export async function attachEmulator(
    context: IActionContext,
    node: AzExtTreeItem | CosmosDBAttachEmulatorResourceItem,
) {
    if (platform() !== 'win32') {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(localize('emulatorNotSupported', 'The Cosmos DB emulator is only supported on Windows.'));
    }

    if (node instanceof AzExtTreeItem) {
        await ext.attachedAccountsNode.attachEmulator(context);
        await ext.rgApi.workspaceResourceTree.refresh(context, ext.attachedAccountsNode);
    }

    if (node instanceof CosmosDBAttachEmulatorResourceItem) {
        const wizardContext: AttachEmulatorWizardContext = { ...context, parentTreeElementId: node.parentId };

        const wizard = new AzureWizard(wizardContext, {
            title: 'Attach Emulator',
            promptSteps: [new PromptExperienceStep(), new PromptPortStep()],
            executeSteps: [new ExecuteStep()],
            showLoadingPrompt: true,
        });

        await wizard.prompt();
        await wizard.execute();
    }
}
