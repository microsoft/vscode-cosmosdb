/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, openReadOnlyJson, parseError } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
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
        placeHolder: l10n.t('Empty or a JSON array, e.g. [1, {"key": "value"}]'),
        validateInput: (value) => {
            try {
                parseParameters(value);
                return undefined;
            } catch (error) {
                return parseError(error).message;
            }
        },
        // @todo: add a learnMoreLink
    });

    const parameters = parseParameters(paramString);

    const databaseId = node.model.database.id;
    const containerId = node.model.container.id;
    const procedureId = node.model.procedure.id;
    const result = await withClaimsChallengeHandling(node.model.accountInfo, async (cosmosClient) => {
        return cosmosClient
            .database(databaseId)
            .container(containerId)
            .scripts.storedProcedure(procedureId)
            .execute(partitionKey, parameters);
    });

    try {
        const resultFileName = `${procedureId}-result`;
        await openReadOnlyJson({ label: resultFileName, fullId: globalThis.crypto.randomUUID() }, result);
    } catch {
        await context.ui.showWarningMessage(l10n.t('Unable to parse execution result'));
    }
}

function parseParameters(value: string): unknown[] | undefined {
    if (value === '') {
        return undefined;
    }

    const message = l10n.t('Enter a valid JSON array, e.g. [1, {"key": "value"}], or leave empty for no parameters.');
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(message);
    }

    if (!Array.isArray(parsed)) {
        throw new Error(message);
    }

    return parsed as unknown[];
}
