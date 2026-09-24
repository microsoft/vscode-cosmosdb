/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';

export async function openAccountJson(
    metadata: Pick<AzureResourceMetadata, 'getClient' | 'resourceGroup' | 'accountName'>,
): Promise<void> {
    const client = await metadata.getClient();
    if (!client) {
        throw new Error(l10n.t('Failed to create CosmosDB management client.'));
    }

    let responseBody: string | null | undefined;
    await client.databaseAccounts.get(metadata.resourceGroup, metadata.accountName, {
        onResponse: (response) => {
            // The SDK model flattens properties, drops unmodeled fields, and converts timestamps to Date.
            responseBody = response.bodyAsText;
        },
    });
    if (!responseBody) {
        throw new Error(l10n.t('Azure Resource Manager returned an empty account response.'));
    }
    const resource: unknown = JSON.parse(responseBody);
    const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(resource, undefined, 2),
    });
    await vscode.window.showTextDocument(document);
}
