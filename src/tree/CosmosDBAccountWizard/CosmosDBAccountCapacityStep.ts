/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { localize } from '../../utils/localize';
import { openUrl } from '../../utils/openUrl';
import { type ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCapacityStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {
    public async prompt(context: ICosmosDBWizardContext): Promise<void> {
        const learnMoreLink: string = 'https://aka.ms/cosmos-models';
        const placeHolder: string = localize('selectDBServerMsg', 'Select a capacity model');
        const picks: IAzureQuickPickItem<boolean | undefined>[] = [
            {
                label: localize('provisionedOption', 'Provisioned Throughput'),
                detail: localize(
                    'provisionedOptionDescription',
                    'Workloads with sustained traffic requiring predictable performance',
                ),
                data: false,
            },
            {
                label: localize('serverlessOption', 'Serverless'),
                detail: localize(
                    'serverlessOptionDescription',
                    'Workloads with intermittent or unpredictable traffic and low average-to-peak traffic ratio',
                ),
                data: true,
            },
        ];
        const learnMore: IAzureQuickPickItem = {
            label: localize('learnMore', '$(link-external) Learn more...'),
            data: undefined,
        };
        picks.push(learnMore);
        let pick: IAzureQuickPickItem<boolean | undefined>;

        do {
            pick = await context.ui.showQuickPick(picks, {
                placeHolder,
                suppressPersistence: true,
                learnMoreLink: learnMoreLink,
            });
            if (pick === learnMore) {
                await openUrl(learnMoreLink);
            }
        } while (pick === learnMore);

        if (pick.data) {
            context.isServerless = pick.data;
            context.telemetry.properties.isServerless = pick.data ? 'true' : 'false';
        }
    }

    public shouldPrompt(context: ICosmosDBWizardContext): boolean {
        return context.isServerless === undefined;
    }
}
