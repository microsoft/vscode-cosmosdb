/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { defaultStoredProcedure } from '../../constants';
import { StoredProcedureFileDescriptor } from '../../cosmosdb/fs/StoredProcedureFileDescriptor';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { CosmosDBStoredProceduresResourceItem } from '../../tree/cosmosdb/CosmosDBStoredProceduresResourceItem';
import { type CosmosDBStoredProcedureModel } from '../../tree/cosmosdb/models/CosmosDBStoredProcedureModel';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { CosmosDBStoredProcedureNameStep } from './CosmosDBStoredProcedureNameStep';
import { type CreateStoredProcedureWizardContext } from './CreateStoredProcedureWizardContext';

export async function cosmosDBCreateStoredProcedure(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem | CosmosDBStoredProceduresResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: 'treeItem.container',
            unexpectedContextValue: [/experience[.](table|cassandra|graph)/i], // Only Core supports triggers
        });

        if (!node) {
            return;
        }
    }

    context.telemetry.properties.experience = node.experience.api;

    const nodeId = node instanceof CosmosDBStoredProceduresResourceItem ? node.id : `${node.id}/storedProcedures`;
    const wizardContext: CreateStoredProcedureWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        containerId: node.model.container.id,
        storedProcedureBody: defaultStoredProcedure,
        nodeId,
    };

    const wizard: AzureWizard<CreateStoredProcedureWizardContext> = new AzureWizard(wizardContext, {
        title: l10n.t('Create stored procedure'),
        promptSteps: [new CosmosDBStoredProcedureNameStep()],
        executeSteps: [new CosmosDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    if (wizardContext.response) {
        const model: CosmosDBStoredProcedureModel = { ...node.model, procedure: wizardContext.response };
        const procedureId = model.procedure.id;
        const fsNode = new StoredProcedureFileDescriptor(`${nodeId}/${procedureId}`, model, node.experience);
        await ext.fileSystem.showTextDocument(fsNode);
    }
}
