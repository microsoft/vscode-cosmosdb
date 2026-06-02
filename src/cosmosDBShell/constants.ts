/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Single source of truth for setting keys, command IDs, and other magic values shared
 * across the Cosmos DB Shell modules. Keeping these here ensures renames stay in lockstep
 * and that build/lint tooling can flag any stray literal references.
 */

/** Display name used for every Cosmos DB Shell terminal created by this extension. */
export const COSMOS_DB_SHELL_TERMINAL_NAME = 'Cosmos DB Shell';

/** Default TCP port used by the Cosmos DB Shell MCP server when the user hasn't overridden it. */
export const DEFAULT_MCP_PORT = 6128;

/** Label published to the VS Code MCP API for the Cosmos DB Shell MCP server. */
export const MCP_SERVER_NAME = 'Azure Cosmos DB Shell';

// --- VS Code setting keys (must match the contributions in package.json) ---
export const SETTING_SHELL_PATH = 'cosmosDB.shell.path';
export const SETTING_MCP_ENABLED = 'cosmosDB.shell.MCP.enabled';
export const SETTING_MCP_PORT = 'cosmosDB.shell.MCP.port';

// --- VS Code command IDs ---
export const COMMAND_LAUNCH_COSMOS_DB_SHELL = 'cosmosDB.launchCosmosDBShell';
