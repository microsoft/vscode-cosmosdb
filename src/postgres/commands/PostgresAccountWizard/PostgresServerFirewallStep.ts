/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as publicIp from 'public-ip';
import { QuickPickItem } from 'vscode';
import { AzureWizardPromptStep } from 'vscode-azureextensionui';
import { ext } from '../../../extensionVariables';
import { localize } from '../../../utils/localize';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerFirewallStep extends AzureWizardPromptStep<IPostgresWizardContext> {

    public async prompt(wizardContext: IPostgresWizardContext): Promise<void> {

        const ip: string = await publicIp.v4();
        const yes: QuickPickItem = { label: localize('addFirewallRule', 'Add firewall rule for IP "{0}"', ip) };
        const no: QuickPickItem = { label: localize('skipFireWallRule', '$(clock) Skip for now') };

        const placeHolder: string = localize('addFirewallForNewServer', 'A firewall rule is required to access this server from your current IP.');

        wizardContext.firewall = await ext.ui.showQuickPick([yes, no], { placeHolder }) === yes;

    }

    public shouldPrompt(wizardContext: IPostgresWizardContext): boolean {
        return !wizardContext.firewall;
    }
}
