/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { FirewallRule } from 'azure-arm-postgresql/lib/models';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, createAzureClient } from 'vscode-azureextensionui';
import { localize } from '../../../utils/localize';
import { nonNullProp } from '../../../utils/nonNull';
import { IPostgresWizardContext } from './IPostgresWizardContext';

export class PostgresServerSetFirewallStep extends AzureWizardExecuteStep<IPostgresWizardContext> {
    public priority: number = 250;

    public async execute(wizardContext: IPostgresWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const ip: string = nonNullProp(wizardContext, 'publicIp');
        const client: PostgreSQLManagementClient = createAzureClient(wizardContext, PostgreSQLManagementClient);
        const resourceGroup: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const newServerName: string = nonNullProp(wizardContext, 'newServerName');
        const firewallRuleName: string = "azureDatabasesForVSCode-publicIp";

        const newFirewallRule: FirewallRule = {
            startIpAddress: ip,
            endIpAddress: ip
        };

        const addFirewallMessage: string = localize('configuringFirewall', 'Adding firewall rule for your IP "{0}" to server "{1}"...', ip, newServerName);
        progress.report({ message: addFirewallMessage });

        await client.firewallRules.createOrUpdate(resourceGroup, newServerName, firewallRuleName, newFirewallRule);

    }

    public shouldExecute(wizardContext: IPostgresWizardContext): boolean {
        return !!wizardContext.addFirewall;
    }
}
