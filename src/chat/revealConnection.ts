/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import * as l10n from '@vscode/l10n';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { revealAzureResourceInExplorer } from '../vscodeUriHandler';

/**
 * Reveals a single Cosmos DB connection's container in the Azure Resources tree.
 *
 * Only Azure-signed-in accounts can be revealed: workspace-attached accounts and the emulator have
 * no Azure resource id to drill into, so those return `{ revealed: false }` with a reason instead of
 * throwing. Shared by the Query Editor chat tools (open / list-open-connections) so the drill-down
 * behavior stays consistent.
 *
 * @returns Whether the reveal happened, plus a human-readable reason when it did not.
 */
export async function revealConnectionInTree(
    connection: NoSqlQueryConnection,
): Promise<{ revealed: boolean; error?: string }> {
    const azureMetadata = connection.azureMetadata;
    if (!azureMetadata) {
        return {
            revealed: false,
            error: l10n.t(
                'The connection to database "{0}" / container "{1}" cannot be revealed in the tree because it is not an Azure-signed-in account (workspace-attached accounts and the emulator are not supported).',
                connection.databaseId,
                connection.containerId,
            ),
        };
    }

    const resourceId = parseAzureResourceId(azureMetadata.accountId);
    await revealAzureResourceInExplorer(undefined, resourceId, connection.databaseId, connection.containerId);
    return { revealed: true };
}
