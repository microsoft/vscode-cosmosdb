/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { defaultStoredProcedure } from '../../constants';
import { StoredProcedureFileDescriptor } from '../../docdb/fs/StoredProcedureFileDescriptor';
import { ext } from '../../extensionVariables';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { DocumentDBStoredProceduresResourceItem } from '../../tree/docdb/DocumentDBStoredProceduresResourceItem';
import { type DocumentDBStoredProcedureModel } from '../../tree/docdb/models/DocumentDBStoredProcedureModel';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateStoredProcedureWizardContext } from './CreateStoredProcedureWizardContext';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { DocumentDBStoredProcedureNameStep } from './DocumentDBStoredProcedureNameStep';

export async function createDocumentDBStoredProcedure(
    context: IActionContext,
    node?: DocumentDBContainerResourceItem | DocumentDBStoredProceduresResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: 'treeItem.container',
            unexpectedContextValue: [/experience[.](table|cassandra|graph)/i], // Only Core supports triggers
        });

        if (!node) {
            return;
        }
    }

    context.telemetry.properties.experience = node.experience.api;

    const nodeId = node instanceof DocumentDBStoredProceduresResourceItem ? node.id : `${node.id}/triggers`;
    const wizardContext: CreateStoredProcedureWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        containerId: node.model.container.id,
        storedProcedureBody: defaultStoredProcedure,
        nodeId,
    };

    const wizard: AzureWizard<CreateStoredProcedureWizardContext> = new AzureWizard(wizardContext, {
        title: localize('cosmosDB.createTrigger.title', 'Create trigger'),
        promptSteps: [new DocumentDBStoredProcedureNameStep()],
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    if (wizardContext.response) {
        ext.state.notifyChildrenChanged(nodeId);

        const model: DocumentDBStoredProcedureModel = { ...node.model, procedure: wizardContext.response };
        const fsNode = new StoredProcedureFileDescriptor(node.id, model, node.experience);
        await ext.fileSystem.showTextDocument(fsNode);
    }
}
