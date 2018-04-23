/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureUserInput, IAzureQuickPickItem, AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';
import { Experience, getExperienceQuickPicks } from '../../experiences';

export class CosmosDBAccountApiStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {
    public async prompt(wizardContext: ICosmosDBWizardContext, ui: IAzureUserInput): Promise<ICosmosDBWizardContext> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ui.showQuickPick(picks, {
            placeHolder: "Select an API for your Cosmos DB account...",
        });

        wizardContext.defaultExperience = result.data;

        return wizardContext;
    }
}
