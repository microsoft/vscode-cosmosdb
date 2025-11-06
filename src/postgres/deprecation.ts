/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { type PostgresServerTreeItem } from './tree/PostgresServerTreeItem';

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
 * @param pgServer - The PostgreSQL server tree item containing connection and subscription information
 * @returns A promise that resolves when the PostgreSQL extension is opened or installed
 *
 * @remarks
 * - If username and password are provided, uses SQL Login authentication
 * - Otherwise, defaults to Azure MFA authentication
 * - Includes Azure subscription ID, resource group, and tenant ID if available
 * - Automatically handles installation of the PostgreSQL extension if not already installed
 */
export async function openPostgresExtension(pgServer: PostgresServerTreeItem): Promise<void> {
    // Build URI with connection parameters
    const params = new URLSearchParams();
    params.append('server', pgServer.partialConnectionString.hostName);
    if (pgServer.partialConnectionString.databaseName) {
        params.append('database', pgServer.partialConnectionString.databaseName);
    }
    if (pgServer.partialConnectionString.port) {
        params.append('port', pgServer.partialConnectionString.port);
    }
    if (pgServer.partialConnectionString.username && pgServer.partialConnectionString.password) {
        params.append('authenticationType', 'SqlLogin');
        params.append('user', pgServer.partialConnectionString.username);
        params.append('password', pgServer.partialConnectionString.password);
    } else {
        params.append('authenticationType', 'AzureMFA');
    }
    if (pgServer.subscription.subscriptionId) {
        params.append('azureSubscriptionId', pgServer.subscription.subscriptionId);
    }
    if (pgServer.resourceGroup) {
        params.append('azureResourceGroup', pgServer.resourceGroup);
    }
    if (pgServer.subscription.tenantId) {
        params.append('tenantId', pgServer.subscription.tenantId);
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

/**
 * Shows an error message for prohibited PostgreSQL operations
 */
export async function showPostgresOperationProhibitedError(): Promise<void> {
    const isExtensionInstalled = isPgSqlExtensionInstalled();

    const message =
        l10n.t(
            'This operation is prohibited. All create, update, and delete PostgreSQL operations are no longer supported as this functionality has been deprecated in the Azure Cosmos DB extension.',
        ) +
        ' ' +
        l10n.t('Please use the dedicated PostgreSQL extension instead.');

    const buttonText = isExtensionInstalled
        ? l10n.t('Open PostgreSQL Extension')
        : l10n.t('Install PostgreSQL Extension');

    const selection = await vscode.window.showErrorMessage(message, { modal: true }, { title: buttonText });

    if (selection) {
        await openOrInstallPgSqlExtension(isExtensionInstalled);
    }
}
