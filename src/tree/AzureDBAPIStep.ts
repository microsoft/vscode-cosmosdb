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
import { localize } from '../utils/localize';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';
import { IAzureDBWizardContext } from './IAzureDBWizardContext';

export class AzureDBAPIStep extends AzureWizardPromptStep<IPostgresWizardContext | ICosmosDBWizardContext> {
    public async prompt(wizardContext: IAzureDBWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ext.ui.showQuickPick(picks, {
            placeHolder: localize('selectDBServerMsg', 'Select an Azure Database Server.')
        });

        wizardContext.defaultExperience = result.data;
    }

    public async getSubWizard(wizardContext: IAzureDBWizardContext): Promise<IWizardOptions<IPostgresWizardContext | ICosmosDBWizardContext>> {
        let promptSteps: AzureWizardPromptStep<IPostgresWizardContext | ICosmosDBWizardContext>[];
        let executeSteps: AzureWizardExecuteStep<IPostgresWizardContext | ICosmosDBWizardContext>[];
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
                new PostgresServerSetFirewallStep()
            ];
            // tslint:disable-next-line: no-unnecessary-local-variable
            const wizardOptions: IWizardOptions<IPostgresWizardContext> = { promptSteps, executeSteps };
            return wizardOptions;
        } else {
            promptSteps = [
                new CosmosDBAccountNameStep()
            ];
            executeSteps = [
                new CosmosDBAccountCreateStep()
            ];
            // tslint:disable-next-line: no-unnecessary-local-variable
            const wizardOptions: IWizardOptions<ICosmosDBWizardContext> = { promptSteps, executeSteps };
            return wizardOptions;
        }
    }

    public shouldPrompt(wizardContext: IAzureDBWizardContext): boolean {
        return !wizardContext.defaultExperience;
    }
}
