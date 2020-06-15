/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { getPublicIp } from '../../configurePostgresFirewall';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerFirewallStep extends AzureWizardPromptStep<IPostgresServerWizardContext> {

    public async prompt(wizardContext: IPostgresServerWizardContext): Promise<void> {

        const placeHolder: string = localize('addFirewallForNewServer', 'A firewall rule is required to access this server from your current IP.');

        wizardContext.addFirewall = (await ext.ui.showQuickPick(this.getPicks(wizardContext), { placeHolder })).data;

    }

    public shouldPrompt(wizardContext: IPostgresServerWizardContext): boolean {
        return wizardContext.addFirewall === undefined;
    }

    public async getPicks(wizardContext: IPostgresServerWizardContext): Promise<IAzureQuickPickItem<boolean>[]> {
        wizardContext.publicIp = await getPublicIp();
        return [
            { label: localize('addFirewallRule', 'Add firewall rule for your IP "{0}"', wizardContext.publicIp), data: true },
            { label: localize('skipFireWallRule', '$(clock) Skip for now'), data: false }
        ];
    }
}
