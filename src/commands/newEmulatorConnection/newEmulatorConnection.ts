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
import * as l10n from '@vscode/l10n';
import { isEmulatorSupported } from '../../constants';
import { type NewCoreEmulatorConnectionItem } from '../../tree/workspace-view/cosmosdb/LocalEmulators/NewCoreEmulatorConnectionItem';
import { ExecuteStep } from './ExecuteStep';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';
import { PromptNosqlEmulatorConnectionStringStep } from './nosql/PromptNosqlEmulatorConnectionStringStep';
import { PromptEmulatorPortStep } from './PromptEmulatorPortStep';
import { PromptEmulatorTypeStep } from './PromptEmulatorTypeStep';

export async function newEmulatorConnection(context: IActionContext, node: NewCoreEmulatorConnectionItem) {
    if (!isEmulatorSupported) {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(l10n.t('The Azure Cosmos DB emulator is only supported on Windows, Linux and MacOS (Intel).'));
    }

    const wizardContext: NewEmulatorConnectionWizardContext = {
        ...context,
        parentTreeElementId: node.parentId,
    };

    const title: string = l10n.t('New Emulator Connection');
    const steps: AzureWizardPromptStep<NewEmulatorConnectionWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<NewEmulatorConnectionWizardContext>[] = [];

    /**
     * Note to code maintainers:
     *
     * We're not adding the *EmulatorSecurityStep* to CoreExperience because we can't disable TLS/SSL
     * for an individual instance of CosmosClient with these features disabled.
     * https://github.com/Azure/azure-sdk-for-js/issues/12687
     */
    steps.push(
        new PromptEmulatorTypeStep(),
        new PromptNosqlEmulatorConnectionStringStep(),
        new PromptEmulatorPortStep(),
    );
    executeSteps.push(new ExecuteStep());

    const wizard = new AzureWizard(wizardContext, {
        title: title,
        promptSteps: steps,
        executeSteps: executeSteps,
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();
}
