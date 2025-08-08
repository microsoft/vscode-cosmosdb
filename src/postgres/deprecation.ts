/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { l10n } from 'vscode';

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
 * Shows a deprecation warning for PostgreSQL functionality
 */
export async function showPostgresDeprecationWarning(): Promise<void> {
    const isExtensionInstalled = isPgSqlExtensionInstalled();

    const message =
        l10n.t('PostgreSQL functionality is no longer supported by Azure CosmosDB extension and has been deprecated.') +
        ' ' +
        l10n.t('Please use the dedicated PostgreSQL extension instead.');

    const buttonText = isExtensionInstalled
        ? l10n.t('Open PostgreSQL Extension')
        : l10n.t('Install PostgreSQL Extension');

    const selection = await vscode.window.showWarningMessage(message, { modal: false }, { title: buttonText });

    if (selection) {
        await openOrInstallPgSqlExtension(isExtensionInstalled);
    }
}

/**
 * Shows an error message for prohibited PostgreSQL operations
 */
export async function showPostgresOperationProhibitedError(): Promise<void> {
    const isExtensionInstalled = isPgSqlExtensionInstalled();

    const message =
        l10n.t(
            'This operation is prohibited. All create, update, and delete PostgreSQL operations are no longer \
            supported as this functionality has been deprecated in the Azure CosmosDB extension.',
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
