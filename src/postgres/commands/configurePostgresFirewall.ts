/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as publicIp from 'public-ip';
import { AzureWizard, DialogResponses, IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { azureUtils } from "../../utils/azureUtils";
import { localize } from "../../utils/localize";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";
import { IPostgresWizardContext } from "./PostgresAccountWizard/IPostgresWizardContext";
import { PostgresServerSetFirewallStep } from "./PostgresAccountWizard/PostgresServerSetFirewallStep";

export async function configurePostgresFirewall(context: IActionContext, treeItem?: PostgresServerTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    const ip: string = await publicIp.v4();
    await ext.ui.showWarningMessage(
        localize('firewallRuleWillBeAdded', 'A firewall rule for your IP ({0}) will be added to server "{1}". Would you like to continue?', ip, treeItem.server.name),
        { modal: true },
        { title: DialogResponses.yes.title }
    );
    const wizardContext: IPostgresWizardContext = Object.assign(context, treeItem.root);
    wizardContext.newResourceGroupName = azureUtils.getResourceGroupFromId(treeItem.id);
    wizardContext.publicIp = await publicIp.v4();
    wizardContext.server = treeItem.server;
    wizardContext.addFirewall = true;

    const wizard = new AzureWizard(wizardContext, {
        executeSteps: [
            new PostgresServerSetFirewallStep()
        ],
        title: localize('addFirewallRule', 'Add Firewall Rule')
    });
    await wizard.execute();
    await treeItem.refresh();
}
