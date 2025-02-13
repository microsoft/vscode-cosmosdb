/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { isEmulatorSupported } from '../../constants';
import { type CosmosDBAttachEmulatorResourceItem } from '../../tree/attached/CosmosDBAttachEmulatorResourceItem';
import { localize } from '../../utils/localize';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptExperienceStep } from './PromptExperienceStep';
import { PromptPortStep } from './PromptPortStep';

export async function attachEmulator(context: IActionContext, node: CosmosDBAttachEmulatorResourceItem) {
    if (!isEmulatorSupported) {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(
            localize(
                'emulatorNotSupported',
                'The Cosmos DB emulator is only supported on Windows, Linux and MacOS (Intel).',
            ),
        );
    }

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
