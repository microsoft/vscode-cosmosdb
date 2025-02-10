/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { defaultTrigger } from '../../constants';
import { TriggerFileDescriptor } from '../../docdb/fs/TriggerFileDescriptor';
import { ext } from '../../extensionVariables';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { DocumentDBTriggersResourceItem } from '../../tree/docdb/DocumentDBTriggersResourceItem';
import { type DocumentDBTriggerModel } from '../../tree/docdb/models/DocumentDBTriggerModel';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { type CreateTriggerWizardContext } from './CreateTriggerWizardContext';
import { DocumentDBExecuteStep } from './DocumentDBExecuteStep';
import { DocumentDBTriggerNameStep } from './DocumentDBTriggerNameStep';
import { DocumentDBTriggerOperationStep } from './DocumentDBTriggerOperationStep';
import { DocumentDBTriggerTypeStep } from './DocumentDBTriggerTypeStep';

export async function createDocumentDBTrigger(
    context: IActionContext,
    node?: DocumentDBContainerResourceItem | DocumentDBTriggersResourceItem,
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

    const nodeId = node instanceof DocumentDBTriggersResourceItem ? node.id : `${node.id}/triggers`;
    const wizardContext: CreateTriggerWizardContext = {
        ...context,
        accountInfo: node.model.accountInfo,
        databaseId: node.model.database.id,
        containerId: node.model.container.id,
        triggerBody: defaultTrigger,
        nodeId,
    };

    const wizard: AzureWizard<CreateTriggerWizardContext> = new AzureWizard(wizardContext, {
        title: localize('cosmosDB.createTrigger.title', 'Create trigger'),
        promptSteps: [
            new DocumentDBTriggerNameStep(),
            new DocumentDBTriggerTypeStep(),
            new DocumentDBTriggerOperationStep(),
        ],
        executeSteps: [new DocumentDBExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    if (wizardContext.response) {
        ext.state.notifyChildrenChanged(nodeId);

        const model: DocumentDBTriggerModel = { ...node.model, trigger: wizardContext.response };
        const fsNode = new TriggerFileDescriptor(node.id, model, node.experience);
        await ext.fileSystem.showTextDocument(fsNode);
    }
}
