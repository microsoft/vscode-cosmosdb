/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions, VerifyProvidersStep } from 'vscode-azureextensionui';
import { API, Experience, getExperienceQuickPicks } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { IPostgresServerWizardContext } from '../postgres/commands/createPostgresServer/IPostgresServerWizardContext';
import { PostgresServerConfirmPWStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerConfirmPWStep';
import { PostgresServerCreateStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCreateStep';
import { PostgresServerCredPWStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCredPWStep';
import { PostgresServerCredUserStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerCredUserStep';
import { PostgresServerFirewallStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerFirewallStep';
import { PostgresServerNameStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerNameStep';
import { PostgresServerSetCredentialsStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerSetCredentialsStep';
import { PostgresServerSetFirewallStep } from '../postgres/commands/createPostgresServer/steps/PostgresServerSetFirewallStep';
import { localize } from '../utils/localize';
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
        if (wizardContext.defaultExperience?.api === API.Postgres) {
            promptSteps = [
                new PostgresServerNameStep(),
                new PostgresServerCredUserStep(),
                new PostgresServerCredPWStep(),
                new PostgresServerConfirmPWStep(),
                new PostgresServerFirewallStep()
            ];
            executeSteps = [
                new PostgresServerCreateStep(),
                new PostgresServerSetCredentialsStep(),
                new PostgresServerSetFirewallStep(),
                new VerifyProvidersStep(['Microsoft.DBforPostgreSQL'])
            ];
        } else {
            promptSteps = [
                new CosmosDBAccountNameStep()
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
