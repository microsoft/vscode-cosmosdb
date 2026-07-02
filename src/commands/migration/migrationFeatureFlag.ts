/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Configuration section and key for the experimental "Cosmos DB Migration (Preview)" feature
 * toggle. The feature is enabled by default; when disabled, the Cosmos DB Migrations workspace
 * node and its entry-point commands are hidden.
 */
export const MIGRATION_ENABLED_SETTING_SECTION = 'cosmosDB';
export const MIGRATION_ENABLED_SETTING_KEY = 'experimental.migration.enabled';

const EXTENSION_ID = 'ms-azuretools.vscode-cosmosdb';

/**
 * Context key mirrored from {@link MIGRATION_ENABLED_SETTING_KEY}. Used by `when` clauses in
 * package.json to show/hide the migration commands and menu entries.
 */
export const MIGRATION_ENABLED_CONTEXT_KEY = 'cosmosDB.migration.enabled';

/**
 * Returns whether this extension is running as a pre-release build.
 *
 * Reads the `preview` marker from this extension's package metadata. If metadata
 * is unavailable (for example in some test harnesses), defaults to `false` so
 * migration remains opt-in.
 */
export function isPreReleaseBuild(): boolean {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    if (!extension) {
        return false;
    }

    const packageJson = extension.packageJSON as { preview?: unknown } | undefined;
    return packageJson?.preview === true;
}

/**
 * Default state for the migration feature when the user has not explicitly
 * configured `cosmosDB.experimental.migration.enabled`.
 *
 * - Pre-release builds: enabled by default.
 * - Stable builds: disabled by default.
 */
export function getMigrationFeatureDefaultEnabled(): boolean {
    return isPreReleaseBuild();
}

/**
 * Returns whether the experimental Cosmos DB Migration (Preview) feature is enabled.
 * Defaults by release channel when the setting is unset:
 * - pre-release builds default to `true`
 * - stable builds default to `false`
 */
export function isMigrationFeatureEnabled(): boolean {
    const defaultEnabled = getMigrationFeatureDefaultEnabled();
    return (
        vscode.workspace
            .getConfiguration(MIGRATION_ENABLED_SETTING_SECTION)
            .get<boolean>(MIGRATION_ENABLED_SETTING_KEY, defaultEnabled) ?? defaultEnabled
    );
}

/**
 * Returns `true` when the given configuration change affects the migration feature toggle.
 */
export function affectsMigrationFeatureSetting(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration(`${MIGRATION_ENABLED_SETTING_SECTION}.${MIGRATION_ENABLED_SETTING_KEY}`);
}
