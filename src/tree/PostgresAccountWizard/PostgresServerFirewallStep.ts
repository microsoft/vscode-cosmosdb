/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { configurePostgresFirewall } from '../../postgres/commands/configurePostgresFirewall';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerFirewallStep extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {
        const pickedOption = await configurePostgresFirewall(wizardContext, undefined, true);
        if (pickedOption === "Yes") {
            wizardContext.firewall = true;
        } else {
            wizardContext.firewall = false;
        }
    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.firewall;
    }
}
