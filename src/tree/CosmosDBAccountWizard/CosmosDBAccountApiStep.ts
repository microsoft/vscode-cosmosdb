/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardStep, IAzureUserInput, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';
import { Experience, DBAccountKind } from '../../constants';
import { getExperienceName } from '../../utils/experienceNames';

export class CosmosDBAccountApiStep extends AzureWizardStep<ICosmosDBWizardContext> {
    public async prompt(wizardContext: ICosmosDBWizardContext, ui: IAzureUserInput): Promise<ICosmosDBWizardContext> {
        const picks: IAzureQuickPickItem<string>[] = [
            { label: getExperienceName(Experience.DocumentDB), description: '', data: DBAccountKind.GlobalDocumentDB },
            { label: getExperienceName(Experience.MongoDB), description: '', data: DBAccountKind.MongoDB },
            { label: getExperienceName(Experience.Table), description: '', data: DBAccountKind.GlobalDocumentDB },
            { label: getExperienceName(Experience.Graph), description: '', data: DBAccountKind.GlobalDocumentDB }
        ];

        const result: IAzureQuickPickItem<string> = await ui.showQuickPick(picks, {
            placeHolder: "Select an API for your Cosmos DB account...",
        });

        wizardContext.defaultExperience = <Experience>result.label;
        wizardContext.kind = <DBAccountKind>result.data;

        return wizardContext;
    }

    public async execute(wizardContext: ICosmosDBWizardContext): Promise<ICosmosDBWizardContext> {
        return wizardContext;
    }
}
