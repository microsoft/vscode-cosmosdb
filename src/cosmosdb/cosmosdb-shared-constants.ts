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

export const wellKnownEmulatorPassword =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';
