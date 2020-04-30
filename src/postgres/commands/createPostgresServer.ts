/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureWizard, AzureWizardPromptStep, IActionContext, ILocationWizardContext, LocationListStep, ResourceGroupListStep } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { SubscriptionTreeItem } from '../../tree/SubscriptionTreeItem';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';
import { IPostgresWizardContext } from './PostgresAccountWizard/IPostgresWizardContext';
import { PostgresServerConfirmPWStep } from './PostgresAccountWizard/PostgresServerConfirmPWStep';
import { PostgresServerCreateStep } from './PostgresAccountWizard/PostgresServerCreateStep';
import { PostgresServerCredPWStep } from './PostgresAccountWizard/PostgresServerCredPWStep';
import { PostgresServerCredUserStep } from './PostgresAccountWizard/PostgresServerCredUserStep';
import { PostgresServerFirewallStep } from './PostgresAccountWizard/PostgresServerFirewallStep';
import { PostgresServerNameStep } from './PostgresAccountWizard/PostgresServerNameStep';
import { PostgresServerSetCredentialsStep } from './PostgresAccountWizard/PostgresServerSetCredentialsStep';
import { PostgresServerSetFirewallStep } from './PostgresAccountWizard/PostgresServerSetFirewallStep';

export async function createPostgresServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<SubscriptionTreeItem>(SubscriptionTreeItem.contextValue, context);
    }
    const wizardContext: IPostgresWizardContext = Object.assign(context, node.root);
    const promptSteps: AzureWizardPromptStep<ILocationWizardContext>[] = [
        new PostgresServerNameStep(),
        new ResourceGroupListStep(),
        new PostgresServerCredUserStep(),
        new PostgresServerCredPWStep(),
        new PostgresServerConfirmPWStep(),
        new PostgresServerFirewallStep()
    ];

    LocationListStep.addStep(wizardContext, promptSteps);
    const wizard = new AzureWizard(wizardContext, {
        promptSteps,
        executeSteps: [
            new PostgresServerCreateStep(),
            new PostgresServerSetCredentialsStep(),
            new PostgresServerSetFirewallStep()
        ],
        title: localize('createPostgresServerPrompt', 'Create new PostgreSQL server')
    });
    await wizard.prompt();
    await wizard.execute();

    vscode.window.showInformationMessage(localize('createdServerMsg', 'Successfully created server "{0}".', wizardContext.accountName));
    const serverTreeItem = new PostgresServerTreeItem(node, nonNullProp(wizardContext, 'server'));

    await serverTreeItem.refresh();

    await node.refresh();
}
