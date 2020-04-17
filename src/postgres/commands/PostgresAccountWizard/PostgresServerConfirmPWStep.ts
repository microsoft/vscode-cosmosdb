/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "vscode-azureextensionui";
import { ext } from "../../../extensionVariables";
import { localize } from "../../../utils/localize";
import { IPostgresWizardContext } from "./IPostgresWizardContext";

export class PostgresServerConfirmPWStep extends AzureWizardPromptStep<IPostgresWizardContext> {
    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        const prompt: string = localize('confirmPassphrase', 'Confirm your passphrase');
        await ext.ui.showInputBox({
            prompt,
            password: true,
            validateInput: async (value: string | undefined): Promise<string | undefined> => await this.validatePassphrase(wizardContext, value)
        });
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !!wizardContext.adminPassword;
    }

    private async validatePassphrase(wizardContext: IPostgresWizardContext, passphrase: string | undefined): Promise<string | undefined> {
        if (passphrase !== wizardContext.adminPassword) {
            return localize('passphraseMatch', 'The passphrases must match.');
        }

        return undefined;
    }
}
