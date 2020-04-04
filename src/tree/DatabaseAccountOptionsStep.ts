/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { IDBAWizardContext } from './IDBAWizardContext';

export class DatabaseAccountOptionsStep extends AzureWizardPromptStep<IDBAWizardContext> {
    public async prompt(wizardContext: IDBAWizardContext): Promise<void> {
        const postgresPick: IAzureQuickPickItem<String> = { data: "postgres", label: "PostgreSQL" };
        const cosmosdbPick: IAzureQuickPickItem<String> = { data: "cosmosdb", label: "CosmosDB" };
        const picks: IAzureQuickPickItem<String>[] = [postgresPick, cosmosdbPick];

        const result: IAzureQuickPickItem<String> = await ext.ui.showQuickPick(picks, {
            placeHolder: "Select a Database Account type."
        });

        wizardContext.accountLabel = result.label;
        wizardContext.accountType = result.data;
    }

    public shouldPrompt(wizardContext: IDBAWizardContext): boolean {
        return !wizardContext.accountType;
    }
}
