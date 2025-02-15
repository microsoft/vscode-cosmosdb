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
import { isEmulatorSupported, isLinux, isWindows } from '../../constants';
import { NewEmulatorConnectionItem } from '../../mongoClusters/tree/workspace/LocalEmulators/NewEmulatorConnectionItem';
import { CosmosDBAttachEmulatorResourceItem } from '../../tree/attached/LocalEmulators/CosmosDBAttachEmulatorResourceItem';
import { localize } from '../../utils/localize';
import { type AttachEmulatorWizardContext } from './AttachEmulatorWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoEmulatorConnectionStringStep } from './mongo/PromptMongoEmulatorConnectionStringStep';
import { PromptMongoEmulatorSecurityStep } from './mongo/PromptMongoEmulatorSecurityStep';
import { PromptMongoEmulatorStep } from './mongo/PromptMongoEmulatorStep';
import { PromptMongoPortStep } from './mongo/PromptMongoPortStep';
import { PromptNosqlEmulatorConnectionStringStep } from './nosql/PromptNosqlEmulatorConnectionStringStep';
import { PromptNosqlEmulatorStep } from './nosql/PromptNosqlEmulatorStep';
import { PromptNosqlPortStep } from './nosql/PromptNosqlPortStep';

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
    } else if (!isEmulatorSupported) {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(
            localize(
                'emulatorNotSupported',
                'The Cosmos DB emulator is only supported on Windows, Linux and MacOS (Intel).',
            ),
        );
    }

    const wizardContext: AttachEmulatorWizardContext = { ...context, parentTreeElementId: node.parentId };

    let title: string = '';
    const steps: AzureWizardPromptStep<AttachEmulatorWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<AttachEmulatorWizardContext>[] = [];

    if (node instanceof NewEmulatorConnectionItem) {
        title = 'New Emulator Connection';
        steps.push(
            new PromptMongoEmulatorStep(),
            new PromptMongoEmulatorConnectionStringStep(),
            new PromptMongoPortStep(),
            new PromptMongoEmulatorSecurityStep(),
        );
        executeSteps.push(new ExecuteStep());
    }

    /**
     * Note to code maintainers:
     *
     * We're not adding the *EmulatorSecurityStep* here becasue we can't disable TLS/SSL
     * for an individual instance of CosmosClient with these features disabled.
     * https://github.com/Azure/azure-sdk-for-js/issues/12687
     */

    if (node instanceof CosmosDBAttachEmulatorResourceItem) {
        title = 'Attach Emulator';
        steps.push(
            new PromptNosqlEmulatorStep(),
            new PromptNosqlEmulatorConnectionStringStep(),
            new PromptNosqlPortStep(),
        );
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
