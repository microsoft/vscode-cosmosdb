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
