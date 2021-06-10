/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class CosmosDBAccountCapacityStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {

    public async prompt(wizardContext: ICosmosDBWizardContext): Promise<void> {

        const placeHolder: string = localize('selectDBServerMsg', 'Select a capacity model.')

        wizardContext.isServerless = (await ext.ui.showQuickPick(
            [
                { label: localize('provisionedOption', 'Provisioned Throughput'), data: false },
                { label: localize('serverlessOption', 'Serverless'), data: true }
            ], { placeHolder })).data;

    }


    public shouldPrompt(wizardContext: ICosmosDBWizardContext): boolean {
        return !wizardContext.isServerless;
    }
}

