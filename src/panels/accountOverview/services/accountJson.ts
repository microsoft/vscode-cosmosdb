/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isUserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { getAccountOverviewMaskedValues } from '../resourceMasking';

export async function openAccountJson(context: IActionContext, metadata: AzureResourceMetadata): Promise<void> {
    context.valuesToMask.push(...getAccountOverviewMaskedValues(metadata));
    const client = await createCosmosDBManagementClient(context, metadata.subscription);
    let responseBody: string | null | undefined;
    try {
        // GET the ARM resource only, never listKeys or connection strings. Preserve unmodeled fields and nesting.
        await client.databaseAccounts.get(metadata.resourceGroup, metadata.accountName, {
            onResponse: (response) => {
                responseBody = response.bodyAsText;
            },
        });
    } catch (error) {
        if (isUserCancelledError(error)) {
            throw error;
        }
        // SDK deserialization errors can include the response body, even before onResponse runs.
        // Do not retain the original error as a cause: RPC telemetry serializes causes as well.
        throw new Error(l10n.t('Unable to retrieve account JSON from Azure Resource Manager.'));
    }
    if (!responseBody) {
        throw new Error(l10n.t('Azure Resource Manager returned an empty account response.'));
    }

    let resource: unknown;
    try {
        resource = JSON.parse(responseBody);
    } catch {
        throw new Error(l10n.t('Azure Resource Manager returned invalid account JSON.'));
    }
    const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(resource, undefined, 2),
    });
    await vscode.window.showTextDocument(document);
}
