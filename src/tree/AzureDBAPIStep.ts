/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from 'vscode-azureextensionui';
import { API, Experience, getExperienceQuickPicks } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { IPostgresWizardContext } from '../postgres/commands/PostgresAccountWizard/IPostgresWizardContext';
import { PostgresServerConfirmPWStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerConfirmPWStep';
import { PostgresServerCreateStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerCreateStep';
import { PostgresServerCredPWStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerCredPWStep';
import { PostgresServerCredUserStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerCredUserStep';
import { PostgresServerFirewallStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerFirewallStep';
import { PostgresServerNameStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerNameStep';
import { PostgresServerSetCredentialsStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerSetCredentialsStep';
import { PostgresServerSetFirewallStep } from '../postgres/commands/PostgresAccountWizard/PostgresServerSetFirewallStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';
import { IAzureDBWizardContext } from './IAzureDBWizardContext';

export class AzureDBAPIStep extends AzureWizardPromptStep<IPostgresWizardContext | ICosmosDBWizardContext> {
    public async prompt(wizardContext: IAzureDBWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ext.ui.showQuickPick(picks, {
            placeHolder: "Select an Azure Database Resource."
        });

        wizardContext.defaultExperience = result.data;
    }

    public async getSubWizard(wizardContext: IAzureDBWizardContext): Promise<IWizardOptions<IPostgresWizardContext | ICosmosDBWizardContext>> {
        if (wizardContext.defaultExperience?.api === API.Postgres) {
            // tslint:disable-next-line: no-shadowed-variable
            const promptSteps: AzureWizardPromptStep<IPostgresWizardContext>[] = [
                new PostgresServerNameStep(),
                new PostgresServerCredUserStep(),
                new PostgresServerCredPWStep(),
                new PostgresServerConfirmPWStep(),
                new PostgresServerFirewallStep()
            ];
            // tslint:disable-next-line: no-shadowed-variable
            const executeSteps: AzureWizardExecuteStep<IPostgresWizardContext>[] = [
                new PostgresServerCreateStep(),
                new PostgresServerSetCredentialsStep(),
                new PostgresServerSetFirewallStep()
            ];
            // tslint:disable-next-line: no-unnecessary-local-variable
            const wizardOptions: IWizardOptions<IPostgresWizardContext> = { promptSteps, executeSteps };
            return wizardOptions;
        }
        const promptSteps: AzureWizardPromptStep<ICosmosDBWizardContext>[] = [
            new CosmosDBAccountNameStep()
        ];
        const executeSteps: AzureWizardExecuteStep<ICosmosDBWizardContext>[] = [
            new CosmosDBAccountCreateStep()
        ];

        return { promptSteps, executeSteps };
    }

    public shouldPrompt(wizardContext: IAzureDBWizardContext): boolean {
        return !wizardContext.defaultExperience;
    }
}
