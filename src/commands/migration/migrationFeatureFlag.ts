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

/**
 * Context key mirrored from {@link MIGRATION_ENABLED_SETTING_KEY}. Used by `when` clauses in
 * package.json to show/hide the migration commands and menu entries.
 */
export const MIGRATION_ENABLED_CONTEXT_KEY = 'cosmosDB.migration.enabled';

/**
 * Returns whether the experimental Cosmos DB Migration (Preview) feature is enabled.
 * Defaults to `true` when the setting is unset.
 */
export function isMigrationFeatureEnabled(): boolean {
    return (
        vscode.workspace
            .getConfiguration(MIGRATION_ENABLED_SETTING_SECTION)
            .get<boolean>(MIGRATION_ENABLED_SETTING_KEY, true) ?? true
    );
}

/**
 * Returns `true` when the given configuration change affects the migration feature toggle.
 */
export function affectsMigrationFeatureSetting(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration(`${MIGRATION_ENABLED_SETTING_SECTION}.${MIGRATION_ENABLED_SETTING_KEY}`);
}
