/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, DeleteConfirmationStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteWizardContext } from './DeleteWizardContext';

export async function cosmosDBDeleteDatabaseAccount(
    context: IActionContext,
    node?: CosmosDBAccountResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
        });
    }

    if (!node) {
        return undefined;
    }

    const accountName = node.account.name;
    const wizardContext: DeleteWizardContext = Object.assign(context, { node });
    const title = l10n.t('Delete Database Account "{0}"', accountName);
    const confirmationMessage = l10n.t('Are you sure you want to delete account "{0}" and its contents?', accountName);

    const wizard = new AzureWizard(wizardContext, {
        title,
        promptSteps: [new DeleteConfirmationStep(confirmationMessage)],
        executeSteps: [new DatabaseAccountDeleteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
