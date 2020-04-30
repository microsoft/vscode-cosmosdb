/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from 'vscode-azureextensionui';
import { API, Experience, getExperienceQuickPicks } from '../../CosmosDBExperiences';
import { ext } from '../../extensionVariables';
import { IPostgresWizardContext } from '../../postgres/commands/PostgresAccountWizard/IPostgresWizardContext';
import { PostgresServerConfirmPWStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerConfirmPWStep';
import { PostgresServerCreateStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerCreateStep';
import { PostgresServerCredPWStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerCredPWStep';
import { PostgresServerCredUserStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerCredUserStep';
import { PostgresServerFirewallStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerFirewallStep';
import { PostgresServerNameStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerNameStep';
import { PostgresServerSetCredentialsStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerSetCredentialsStep';
import { PostgresServerSetFirewallStep } from '../../postgres/commands/PostgresAccountWizard/PostgresServerSetFirewallStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountApiStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {
    public async prompt(wizardContext: ICosmosDBWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ext.ui.showQuickPick(picks, {
            placeHolder: "Select an API for your Azure Database account."
        });

        wizardContext.defaultExperience = result.data;
    }

    public async getSubWizard(wizardContext: ICosmosDBWizardContext): Promise<IWizardOptions<ICosmosDBWizardContext>> {
        if (wizardContext.defaultExperience?.api === API.Postgres) {
            // tslint:disable-next-line: no-shadowed-variable
            const promptSteps: AzureWizardPromptStep<IPostgresWizardContext | ICosmosDBWizardContext>[] = [
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

            return { promptSteps, executeSteps };
        }
        const promptSteps: AzureWizardPromptStep<ICosmosDBWizardContext>[] = [
            new CosmosDBAccountNameStep()
        ];
        const executeSteps: AzureWizardExecuteStep<ICosmosDBWizardContext>[] = [
            new CosmosDBAccountCreateStep()
        ];

        return { promptSteps, executeSteps };
    }

    public shouldPrompt(wizardContext: ICosmosDBWizardContext): boolean {
        return !wizardContext.defaultExperience;
    }
}
