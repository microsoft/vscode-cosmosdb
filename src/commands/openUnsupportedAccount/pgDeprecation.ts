/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { type CosmosDBAccountUnsupportedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountUnsupportedResourceItem';
import { createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../../utils/azureClients';
import { nonNullProp } from '../../utils/nonNull';

/**
 * Checks if the PostgreSQL extension is installed
 */
function isPgSqlExtensionInstalled(): boolean {
    return !!vscode.extensions.getExtension('ms-ossdata.vscode-pgsql');
}

/**
 * Opens or installs the PostgreSQL extension
 */
async function openOrInstallPgSqlExtension(isInstalled: boolean): Promise<void> {
    if (isInstalled) {
        // Try to open the PostgreSQL extension's dedicated view in the activity bar
        try {
            // First attempt to focus the PostgreSQL view container
            await vscode.commands.executeCommand('workbench.view.extension.pgObjectExplorer');
        } catch {
            // Fallback: If the specific command isn't available, open extensions view
            await vscode.commands.executeCommand('workbench.view.extensions');
            await vscode.commands.executeCommand('workbench.extensions.search', 'ms-ossdata.vscode-pgsql');
        }
    } else {
        // Open extension in marketplace
        await vscode.commands.executeCommand(
            'vscode.open',
            vscode.Uri.parse('vscode:extension/ms-ossdata.vscode-pgsql'),
        );
    }
}

/**
 * Opens the PostgreSQL extension with connection parameters from a PostgreSQL server tree item.
 * Constructs a URI with server connection details including hostname, database, port, and authentication
 * credentials. Supports both SQL Login and Azure MFA authentication types. The URI is then opened
 * externally to trigger the PostgreSQL extension connection flow.
 *
 * @param node - The PostgreSQL server tree item containing connection and subscription information
 * @returns A promise that resolves when the PostgreSQL extension is opened or installed
 *
 * @remarks
 * - If username and password are provided, uses SQL Login authentication
 * - Otherwise, defaults to Azure MFA authentication
 * - Includes Azure subscription ID, resource group, and tenant ID if available
 * - Automatically handles installation of the PostgreSQL extension if not already installed
 */
export async function openPostgresExtension(node: CosmosDBAccountUnsupportedResourceItem): Promise<void> {
    return await callWithTelemetryAndErrorHandling('postgreSQL.openPostgresExtension', async (context) => {
        if ('subscription' in node.account && node.account.subscription) {
            // Build URI with connection parameters
            const params = new URLSearchParams();

            const resourceGroupName = getResourceGroupFromId(node.account.id);
            const postgresClient =
                node.experience.api === API.PostgresSingle
                    ? await createPostgreSQLClient(context, node.account.subscription)
                    : await createPostgreSQLFlexibleClient(context, node.account.subscription);
            const postgresServer = await postgresClient.servers.get(resourceGroupName, node.account.name);
            const fullyQualifiedDomainName = nonNullProp(postgresServer, 'fullyQualifiedDomainName');

            params.append('server', fullyQualifiedDomainName);
            params.append('port', '5432');
            params.append('authenticationType', 'AzureMFA');
            params.append('azureResourceGroup', resourceGroupName);

            if (node.account.subscription.subscriptionId) {
                params.append('azureSubscriptionId', node.account.subscription.subscriptionId);
            }
            if (node.account.subscription.tenantId) {
                params.append('tenantId', node.account.subscription.tenantId);
            }

            const uri = vscode.Uri.from({
                scheme: vscode.env.uriScheme,
                authority: 'ms-ossdata.vscode-pgsql',
                path: '/connect',
                query: params.toString(),
            });

            // Open the URI using VS Code's openExternal API to trigger the PostgreSQL extension connection
            await vscode.env.openExternal(uri);
            await openOrInstallPgSqlExtension(isPgSqlExtensionInstalled());
        }
    });
}
