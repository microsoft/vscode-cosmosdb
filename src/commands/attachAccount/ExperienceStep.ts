/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureWizardExecuteStep, AzureWizardPromptStep, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { API } from '../../AzureDBExperiences';
import { pickExperience } from '../../utils/pickItem/pickExperience';
import { type AttachAccountWizardContext } from './AttachAccountWizardContext';
import { DocumentDBConnectionStringStep } from './DocumentDBConnectionStringStep';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { MongoConnectionStringStep } from './MongoConnectionStringStep';
import { MongoExecuteStep } from './MongoExecuteStep';
import { MongoPasswordStep } from './MongoPasswordStep';
import { MongoUsernameStep } from './MongoUsernameStep';
import { PostgresConnectionStringStep } from './PostgresConnectionStringStep';
import { PostgresExecuteStep } from './PostgresExecuteStep';
import { PostgresPasswordStep } from './PostgresPasswordStep';
import { PostgresUsernameStep } from './PostgresUsernameStep';

export class ExperienceStep extends AzureWizardPromptStep<AttachAccountWizardContext> {
    public async prompt(context: AttachAccountWizardContext): Promise<void> {
        context.experience = await pickExperience(context, context.quickPickType);
    }

    public async getSubWizard(
        context: AttachAccountWizardContext,
    ): Promise<IWizardOptions<AttachAccountWizardContext>> {
        const promptSteps: AzureWizardPromptStep<AttachAccountWizardContext>[] = [];
        const executeSteps: AzureWizardExecuteStep<AttachAccountWizardContext>[] = [];
        const api = context.experience?.api;

        if (api === API.PostgresSingle || api === API.PostgresFlexible) {
            promptSteps.push(
                new PostgresConnectionStringStep(),
                new PostgresUsernameStep(),
                new PostgresPasswordStep(),
            );
            executeSteps.push(new PostgresExecuteStep());
        } else if (api === API.MongoDB || api === API.MongoClusters) {
            promptSteps.push(new MongoConnectionStringStep(), new MongoUsernameStep(), new MongoPasswordStep());
            executeSteps.push(new MongoExecuteStep());
        } else if (api === API.Core || api === API.Table || api === API.Graph || api === API.Cassandra) {
            promptSteps.push(new DocumentDBConnectionStringStep());
            executeSteps.push(new DocumentDBExecuteStep());
        }
        return { promptSteps, executeSteps };
    }

    public shouldPrompt(context: AttachAccountWizardContext): boolean {
        return !context.experience;
    }
}
