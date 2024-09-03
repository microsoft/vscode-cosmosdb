/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../../utils/localize';
import  { type IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerConfirmPWStep extends AzureWizardPromptStep<IPostgresServerWizardContext> {
    public async prompt(context: IPostgresServerWizardContext): Promise<void> {
        const prompt: string = localize('confirmPW', 'Confirm your password');
        await context.ui.showInputBox({
            prompt,
            password: true,
            validateInput: async (value: string | undefined): Promise<string | undefined> =>
                await this.validatePassword(context, value),
        });
    }

    public shouldPrompt(context: IPostgresServerWizardContext): boolean {
        return !!context.adminPassword;
    }

    private async validatePassword(
        context: IPostgresServerWizardContext,
        passphrase: string | undefined,
    ): Promise<string | undefined> {
        if (passphrase !== context.adminPassword) {
            return localize('pwMatch', 'The passwords must match.');
        }

        return undefined;
    }
}
