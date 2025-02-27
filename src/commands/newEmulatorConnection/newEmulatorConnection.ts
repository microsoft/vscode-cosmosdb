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
import { API } from '../../AzureDBExperiences';
import { isEmulatorSupported } from '../../constants';
import { NewMongoEmulatorConnectionItem } from '../../mongoClusters/tree/workspace/LocalEmulators/NewMongoEmulatorConnectionItem';
import { NewCoreEmulatorConnectionItem } from '../../tree/workspace/LocalEmulators/NewCoreEmulatorConnectionItem';
import { localize } from '../../utils/localize';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoEmulatorConnectionStringStep } from './mongo/PromptMongoEmulatorConnectionStringStep';
import { PromptMongoEmulatorSecurityStep } from './mongo/PromptMongoEmulatorSecurityStep';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';
import { PromptNosqlEmulatorConnectionStringStep } from './nosql/PromptNosqlEmulatorConnectionStringStep';
import { PromptEmulatorPortStep } from './PromptEmulatorPortStep';
import { PromptEmulatorTypeStep } from './PromptEmulatorTypeStep';

export async function newEmulatorConnection(
    context: IActionContext,
    node: NewCoreEmulatorConnectionItem | NewMongoEmulatorConnectionItem,
) {
    if (!isEmulatorSupported) {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(
            node instanceof NewMongoEmulatorConnectionItem
                ? localize(
                      'mongoEmulatorNotSupported',
                      'The Azure Cosmos DB emulator for MongoDB is only supported on Windows, Linux and MacOS (Intel).',
                  )
                : localize(
                      'emulatorNotSupported',
                      'The Azure Cosmos DB emulator is only supported on Windows, Linux and MacOS (Intel).',
                  ),
        );
    }

    const wizardContext: NewEmulatorConnectionWizardContext = {
        ...context,
        parentTreeElementId: node.parentId,
    };

    let title: string = '';
    const steps: AzureWizardPromptStep<NewEmulatorConnectionWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<NewEmulatorConnectionWizardContext>[] = [];

    if (node instanceof NewMongoEmulatorConnectionItem) {
        title = 'New Emulator Connection';
        steps.push(
            new PromptEmulatorTypeStep(API.MongoDB),
            new PromptMongoEmulatorConnectionStringStep(),
            new PromptEmulatorPortStep(),
            new PromptMongoEmulatorSecurityStep(),
        );
        executeSteps.push(new ExecuteStep());
    }

    /**
     * Note to code maintainers:
     *
     * We're not adding the *EmulatorSecurityStep* to CoreExperience becasue we can't disable TLS/SSL
     * for an individual instance of CosmosClient with these features disabled.
     * https://github.com/Azure/azure-sdk-for-js/issues/12687
     */

    if (node instanceof NewCoreEmulatorConnectionItem) {
        title = 'New Emulator Connection';
        steps.push(
            new PromptEmulatorTypeStep(API.Core),
            new PromptNosqlEmulatorConnectionStringStep(),
            new PromptEmulatorPortStep(),
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
