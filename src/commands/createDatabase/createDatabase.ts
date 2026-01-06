/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { getAccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountAttachedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { CosmosDBDatabaseNameStep } from './CosmosDBDatabaseNameStep';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export async function cosmosDBCreateDatabase(
    context: IActionContext,
    node?: CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        accountInfo: await getAccountInfo(node.account),
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new CosmosDBDatabaseNameStep()],
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}
