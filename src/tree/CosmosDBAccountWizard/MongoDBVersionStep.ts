/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { ICosmosDBWizardContext } from './ICosmosDBWizardContext';

export class MongoVersionStep extends AzureWizardPromptStep<ICosmosDBWizardContext> {

    public async prompt(context: ICosmosDBWizardContext): Promise<void> {
        const mongoVersionOption = await context.ui.showQuickPick([
            { label: "v4.0", detail: "4.0", picked: true },
            { label: "v3.6", detail: "3.6", picked: false },
            { label: "v3.2", detail: "3.2", picked: false },
        ], {
            placeHolder: "Select MongoDB version",
            canPickMany: false
        });
        context.mongoVersion = mongoVersionOption.detail;
    }

    public shouldPrompt(_context: ICosmosDBWizardContext): boolean {
        return true;
    }
}
