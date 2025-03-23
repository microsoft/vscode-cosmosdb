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
import { API } from '../../AzureDBExperiences';
import { isEmulatorSupported } from '../../constants';
import { NewCoreEmulatorConnectionItem } from '../../tree/workspace-view/cosmosdb/LocalEmulators/NewCoreEmulatorConnectionItem';
import { NewEmulatorConnectionItem } from '../../tree/workspace-view/documentdb/LocalEmulators/NewEmulatorConnectionItem';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoEmulatorConnectionStringStep } from './mongo/PromptMongoEmulatorConnectionStringStep';
import { PromptMongoEmulatorSecurityStep } from './mongo/PromptMongoEmulatorSecurityStep';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';
import { PromptNosqlEmulatorConnectionStringStep } from './nosql/PromptNosqlEmulatorConnectionStringStep';
import { PromptEmulatorPortStep } from './PromptEmulatorPortStep';
import { PromptEmulatorTypeStep } from './PromptEmulatorTypeStep';

export async function newEmulatorConnection(
    context: IActionContext,
    node: NewCoreEmulatorConnectionItem | NewEmulatorConnectionItem,
) {
    if (!isEmulatorSupported) {
        context.errorHandling.suppressReportIssue = true;
        throw new Error(
            node instanceof NewEmulatorConnectionItem
                ? l10n.t(
                      'The Azure Cosmos DB emulator for MongoDB is only supported on Windows, Linux and MacOS (Intel).',
                  )
                : l10n.t('The Azure Cosmos DB emulator is only supported on Windows, Linux and MacOS (Intel).'),
        );
    }

    const wizardContext: NewEmulatorConnectionWizardContext = {
        ...context,
        parentTreeElementId: node.parentId,
    };

    let title: string = '';
    const steps: AzureWizardPromptStep<NewEmulatorConnectionWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<NewEmulatorConnectionWizardContext>[] = [];

    if (node instanceof NewEmulatorConnectionItem) {
        title = l10n.t('New Emulator Connection');
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
        title = l10n.t('New Emulator Connection');
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
