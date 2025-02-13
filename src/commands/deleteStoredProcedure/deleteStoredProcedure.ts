/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type DocumentDBStoredProcedureResourceItem } from '../../tree/docdb/DocumentDBStoredProcedureResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function deleteDocumentDBStoredProcedure(
    context: IActionContext,
    node: DocumentDBStoredProcedureResourceItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (!node) {
        node = await pickAppResource<DocumentDBStoredProcedureResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.storedProcedure'],
        });
    }

    if (!node) {
        return undefined;
    }

    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const procedureId = node.model.procedure.id;

    const confirmed = await getConfirmationAsInSettings(
        `Delete "${procedureId}"?`,
        `Delete stored procedure "${procedureId}" and its contents?\nThis can't be undone.`,
        procedureId,
    );

    if (!confirmed) {
        return;
    }

    const accountInfo = node.model.accountInfo;
    const client = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, accountInfo.isEmulator);

    try {
        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            const response = await client
                .database(databaseId)
                .container(containerId)
                .scripts.storedProcedure(procedureId)
                .delete();
            success = response.statusCode === 204;
        });

        if (success) {
            showConfirmationAsInSettings(
                localize(
                    'showConfirmation.droppedStoredProcedure',
                    'The stored procedure {0} has been deleted.',
                    procedureId,
                ),
            );
        }
    } finally {
        const lastSlashIndex = node.id.lastIndexOf('/');
        let parentId = node.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}
