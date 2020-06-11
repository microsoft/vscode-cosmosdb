/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "vscode-azureextensionui";
import { ext } from "../../../../extensionVariables";
import { localize } from "../../../../utils/localize";
import { validateIdentifier } from "../validateIdentifier";
import { IPostgresFunctionQueryWizardContext } from "./IPostgresFunctionQueryWizardContext";

export class FunctionQueryNameStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(wizardContext: IPostgresFunctionQueryWizardContext): Promise<void> {
        wizardContext.name = (await ext.ui.showInputBox({
            prompt: localize('provideFunctionName', 'Provide function name'),
            validateInput: validateIdentifier
        })).trim();
    }

    public shouldPrompt(wizardContext: IPostgresFunctionQueryWizardContext): boolean {
        return !wizardContext.name;
    }
}
