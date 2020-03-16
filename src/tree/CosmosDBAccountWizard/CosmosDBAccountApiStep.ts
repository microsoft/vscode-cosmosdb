/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { Experience, getExperienceQuickPicks } from '../../experiences';
import { ext } from '../../extensionVariables';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountApiStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {
    public async prompt(wizardContext: ICosmosDBWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<Experience>[] = getExperienceQuickPicks();

        const result: IAzureQuickPickItem<Experience> = await ext.ui.showQuickPick(picks, {
            placeHolder: "Select an API for your Cosmos DB account."
        });

        wizardContext.defaultExperience = result.data;
    }

    public shouldPrompt(wizardContext: ICosmosDBWizardContext): boolean {
        return !wizardContext.defaultExperience;
    }
}
