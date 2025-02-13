/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    type AzureWizardExecuteStep,
    type AzureWizardPromptStep,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { isLinux, isWindows } from '../../constants';
import { NewEmulatorConnectionItem } from '../../mongoClusters/tree/workspace/LocalEmulators/NewEmulatorConnectionItem';
import { CosmosDBAttachEmulatorResourceItem } from '../../tree/attached/CosmosDBAttachEmulatorResourceItem';
import { localize } from '../../utils/localize';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoEmulatorStep } from './mongo/PromptMongoEmulatorStep';
import { PromptMongoPortStep } from './mongo/PromptMongoPortStep';
import { PromptExperienceStep } from './PromptExperienceStep';
import { PromptPortStep } from './PromptPortStep';

export async function attachEmulator(
    context: IActionContext,
    node: CosmosDBAttachEmulatorResourceItem | NewEmulatorConnectionItem,
) {
    if (node instanceof NewEmulatorConnectionItem) {
        if (!isWindows && !isLinux) {
            context.errorHandling.suppressReportIssue = true;
            throw new Error(
                localize(
                    'mongoEmulatorNotSupported',
                    'The Azure Cosmos DB emulator for MongoDB is only supported on Windows and Linux.',
                ),
            );
        }
    } else {
        if (!isWindows) {
            context.errorHandling.suppressReportIssue = true;
            throw new Error(
                localize('emulatorNotSupported', 'The Azure Cosmos DB emulator is only supported on Windows.'),
            );
        }
    }

    const wizardContext: AttachEmulatorWizardContext = { ...context, parentTreeElementId: node.parentId };

    let title: string = '';
    const steps: AzureWizardPromptStep<AttachEmulatorWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<AttachEmulatorWizardContext>[] = [];

    if (node instanceof NewEmulatorConnectionItem) {
        title = 'New Emulator Connection';
        steps.push(new PromptMongoEmulatorStep(), new PromptMongoPortStep());
        executeSteps.push(new ExecuteStep());
    }

    if (node instanceof CosmosDBAttachEmulatorResourceItem) {
        title = 'Attach Emulator';
        steps.push(new PromptExperienceStep(), new PromptPortStep());
        executeSteps.push(new ExecuteStep());
    }

    const wizard = new AzureWizard(wizardContext, {
        title: title,
        promptSteps: steps,
        executeSteps: executeSteps,
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();
}
