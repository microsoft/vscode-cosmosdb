/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions, VerifyProvidersStep } from 'vscode-azureextensionui';
import { API, Experience, getExperienceQuickPicks } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { PostgresServerType } from '../postgres/abstract/models';
import { IPostgresServerWizardContext } from '../postgres/commands/createPostgresServer/IPostgresServerWizardContext';
import { PostgresServerConfirmPWStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerConfirmPWStep';
import { PostgresServerCreateStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCreateStep';
import { PostgresServerCredPWStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCredPWStep';
import { PostgresServerCredUserStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCredUserStep';
import { PostgresServerNameStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerNameStep';
import { PostgresServerSetCredentialsStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerSetCredentialsStep';
import { PostgresServerSkuStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerSkuStep';
import { localize } from '../utils/localize';
import { CosmosDBAccountCapacityStep } from './CosmosDBAccountWizard/CosmosDBAccountCapacityStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';
import { IAzureDBWizardContext } from './IAzureDBWizardContext';

export class AzureDBAPIStep extends AzureWizardPromptStep<IPostgresServerWizardContext | ICosmosDBWizardContext> {
    public async prompt(wizardContext: IAzureDBWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ext.ui.showQuickPick(picks, {
            placeHolder: localize('selectDBServerMsg', 'Select an Azure Database Server.')
        });

        wizardContext.defaultExperience = result.data;
    }

    public async getSubWizard(wizardContext: IAzureDBWizardContext): Promise<IWizardOptions<IPostgresServerWizardContext | ICosmosDBWizardContext>> {
        let promptSteps: AzureWizardPromptStep<IPostgresServerWizardContext | ICosmosDBWizardContext>[];
        let executeSteps: AzureWizardExecuteStep<IPostgresServerWizardContext | ICosmosDBWizardContext>[];
        if (wizardContext.defaultExperience?.api === API.Postgres || wizardContext.defaultExperience?.api === API.PostgresFlexible) {
            switch (wizardContext.defaultExperience?.api){
                case API.PostgresFlexible:
                    (wizardContext as IPostgresServerWizardContext).serverType = PostgresServerType.Flexible;
                    break;
                case API.Postgres:
                    (wizardContext as IPostgresServerWizardContext).serverType = PostgresServerType.Single;
                    break;
            }
            promptSteps = [
                new PostgresServerNameStep(),
                new PostgresServerSkuStep(),
                new PostgresServerCredUserStep(),
                new PostgresServerCredPWStep(),
                new PostgresServerConfirmPWStep(),
            ];
            executeSteps = [
                new PostgresServerCreateStep(),
                new PostgresServerSetCredentialsStep(),
                new VerifyProvidersStep(['Microsoft.DBforPostgreSQL'])
            ];
        } else {
            promptSteps = [
                new CosmosDBAccountNameStep(),
                new CosmosDBAccountCapacityStep(),
            ];
            executeSteps = [
                new CosmosDBAccountCreateStep(),
                new VerifyProvidersStep(['Microsoft.DocumentDB'])
            ];
        }
        return { promptSteps, executeSteps };
    }

    public shouldPrompt(wizardContext: IAzureDBWizardContext): boolean {
        return !wizardContext.defaultExperience;
    }
}
