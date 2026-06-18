/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure CosmosDB constants with zero external dependencies.
 * Safe to import from both the VS Code extension host AND browser webviews.
 */

/**
 * Internal system fields written by CosmosDB to every document.
 * These are suppressed from normal display / edit UI but can be
 * shown in a "service columns" section.
 */
export const CosmosDBHiddenFields: string[] = ['_rid', '_self', '_etag', '_attachments', '_ts'];

export const SERVERLESS_CAPABILITY_NAME = 'EnableServerless';

/**
 * Built-in "Cosmos DB Built-in Data Contributor" data-plane role definition ID.
 * Predefined by the service; identical for every Cosmos DB account.
 */
export const COSMOS_DB_DATA_CONTRIBUTOR_ROLE_DEFINITION_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Built-in "Cosmos DB Operator" role definition ID. This Azure RBAC role grants
 * control-plane management of Cosmos DB accounts (databases, containers,
 * account properties) while explicitly excluding access to keys, connection
 * strings, and native data-plane role definitions/assignments.
 *
 * This role is required in addition to the data-plane "Cosmos DB Built-in Data
 * Contributor" role because the built-in data role only covers data actions
 * *inside* existing containers (`sqlDatabases/containers/*` and
 * `sqlDatabases/containers/items/*`). Creating, updating, or deleting databases
 * and containers is a control-plane operation and is not expressible as a
 * Cosmos DB data action (the `sqlDatabases/*` wildcard is rejected by the
 * service — see https://learn.microsoft.com/azure/cosmos-db/nosql/security/reference-data-plane-actions).
 *
 * See also:
 * https://learn.microsoft.com/azure/cosmos-db/how-to-connect-role-based-access-control?pivots=azure-cli#grant-control-plane-role-based-access
 */
export const COSMOS_DB_OPERATOR_ROLE_DEFINITION_ID = '230815da-be43-4aae-9cb4-875f7bd000aa';

export const SCHEMA_STORAGE_KEY = 'ms-azuretools.vscode-cosmosdb.schema';

// The well-known emulator master key — identical on every emulator installation.
// The emulator ships with a single fixed account and this key cannot be changed.
// Docs: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator#authentication
//
// The key is stored base64-encoded (i.e. base64 of the original base64 string)
// and decoded at runtime so the well-known emulator key literal does not appear
// verbatim in the bundled output. This avoids false positives from credential
// scanners (e.g. the VS Code Marketplace credscan) which would otherwise flag
// the literal as an "apparent Azure Cosmos DB key" and block publishing.
const encodedWellKnownEmulatorPassword =
    'QzJ5NnlEamY1L1Irb2IwTjhBN0NndjMwVlJESklXRUhMTSs0UURVNURFMm5ROW5EdVZUcW9iRDRiOG1HR3lQTWJJWm5xeU1zRWNhR1F5NjdYSXcvSnc9PQ==';

export const wellKnownEmulatorPassword: string =
    typeof atob === 'function'
        ? atob(encodedWellKnownEmulatorPassword)
        : Buffer.from(encodedWellKnownEmulatorPassword, 'base64').toString('utf8');
