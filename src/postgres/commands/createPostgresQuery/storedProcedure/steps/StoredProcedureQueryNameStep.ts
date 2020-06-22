/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "vscode-azureextensionui";
import { ext } from "../../../../../extensionVariables";
import { localize } from "../../../../../utils/localize";
import { IPostgresQueryWizardContext } from "../../IPostgresQueryWizardContext";
import { validateIdentifier } from "../../validateIdentifier";

export class StoredProcedureQueryNameStep extends AzureWizardPromptStep<IPostgresQueryWizardContext> {
    public async prompt(wizardContext: IPostgresQueryWizardContext): Promise<void> {
        wizardContext.name = (await ext.ui.showInputBox({
            prompt: localize('provideStoredProcedureName', 'Provide stored procedure name'),
            validateInput: validateIdentifier
        })).trim();
    }

    public shouldPrompt(wizardContext: IPostgresQueryWizardContext): boolean {
        return !wizardContext.name;
    }
}
