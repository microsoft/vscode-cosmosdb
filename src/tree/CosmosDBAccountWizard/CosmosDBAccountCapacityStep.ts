/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { openUrl } from '../../utils/openUrl';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCapacityStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {

    public async prompt(wizardContext: ICosmosDBWizardContext): Promise<void> {

        const placeHolder: string = localize('selectDBServerMsg', 'Select a capacity model.')
        const picks: IAzureQuickPickItem<boolean | undefined>[] = [
            { label: localize('provisionedOption', 'Provisioned Throughput'), data: false },
            { label: localize('serverlessOption', 'Serverless'), data: true },
        ];
        const learnMore: IAzureQuickPickItem = { label: localize('learnMore', '$(link-external) Learn more...'), description: '', data: undefined };
        picks.push(learnMore);
        let pick: IAzureQuickPickItem<boolean | undefined>;

        do {
            pick = await ext.ui.showQuickPick(picks, { placeHolder, suppressPersistence: true });
            if (pick === learnMore) {
                await openUrl('https://aka.ms/cosmos-models');
            }
        } while (pick === learnMore);

        if (pick.data) {
            wizardContext.isServerless = pick.data;
            wizardContext.telemetry.properties.isServerless = pick.data ? 'true' : 'false';
        }



    }


    public shouldPrompt(wizardContext: ICosmosDBWizardContext): boolean {
        return wizardContext.isServerless === undefined;
    }
}

