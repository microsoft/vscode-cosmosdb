/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, openReadOnlyJson, randomUtils } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { type CosmosDBStoredProcedureResourceItem } from '../../tree/cosmosdb/CosmosDBStoredProcedureResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBExecuteStoredProcedure(
    context: IActionContext,
    node?: CosmosDBStoredProcedureResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBStoredProcedureResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.storedProcedure'],
        });
    }

    const partitionKey = await context.ui.showInputBox({
        title: l10n.t('Partition Key'),
        // @todo: add a learnMoreLink
    });

    const paramString = await context.ui.showInputBox({
        title: l10n.t('Parameters'),
        placeHolder: l10n.t('empty or array of values e.g. [1, {key: value}]'),
        // @todo: add a learnMoreLink
    });

    let parameters: (string | number | object)[] | undefined = undefined;
    if (paramString !== '') {
        try {
            parameters = JSON.parse(paramString) as (string | number | object)[];
        } catch {
            // Ignore parameters if they are invalid
        }
    }

    const { endpoint, credentials, isEmulator } = node.model.accountInfo;
    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const procedureId = node.model.procedure.id;
    const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
    const result = await cosmosClient
        .database(databaseId)
        .container(containerId)
        .scripts.storedProcedure(procedureId)
        .execute(partitionKey, parameters);

    try {
        const resultFileName = `${procedureId}-result`;
        await openReadOnlyJson({ label: resultFileName, fullId: randomUtils.getRandomHexString() }, result);
    } catch {
        await context.ui.showWarningMessage(l10n.t('Unable to parse execution result'));
    }
}
