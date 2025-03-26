/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the external face of extension.bundle.js, the main webpack bundle for the extension.
 * Anything needing to be exposed outside of the extension sources must be exported from here, because
 * everything else will be in private modules in extension.bundle.js.
 */

// Export activate/deactivate for main.js
// The tests use instanceof against these and therefore we need to make sure we're using the same version of the bson module in the tests as in the bundle,
//   so export it from the bundle itself.
export { ObjectId } from 'bson';
// Exports for tests
// The tests are not packaged with the webpack bundle and therefore only have access to code exported from this file.
//
// The tests should import '../extension.bundle.ts'. At design-time they live in tests/ and so will pick up this file (extension.bundle.ts).
// At runtime the tests live in dist/tests and will therefore pick up the main webpack bundle at dist/extension.bundle.js.
export { AzureAccountTreeItemBase, createAzureClient } from '@microsoft/vscode-azext-azureutils';
export * from '@microsoft/vscode-azext-utils';
export { isWindows, wellKnownEmulatorPassword } from './src/constants';
export { ParsedCosmosConnectionString, parseCosmosConnectionString } from './src/cosmosdb/cosmosConnectionStrings';
export { getCosmosClient } from './src/cosmosdb/getCosmosClient';
export * from './src/cosmosdb/registerCosmosCommands';
export { connectToClient, isCosmosEmulatorConnectionString } from './src/documentdb/scrapbook/connectToClient';
export { MongoCommand } from './src/documentdb/scrapbook/MongoCommand';
export {
    addDatabaseToAccountConnectionString,
    encodeMongoConnectionString,
    getDatabaseNameFromConnectionString,
} from './src/documentdb/scrapbook/mongoConnectionStrings';
export * from './src/documentdb/scrapbook/registerScrapbookCommands';
export { findCommandAtPosition, getAllCommandsFromText } from './src/documentdb/scrapbook/ScrapbookHelpers';
export { ShellScriptRunner as MongoShell } from './src/documentdb/scrapbook/ShellScriptRunner';
export { activateInternal, deactivateInternal } from './src/extension';
export { ext } from './src/extensionVariables';
export { addDatabaseToConnectionString } from './src/postgres/postgresConnectionStrings';
export { SettingUtils } from './src/services/SettingsService';
export { AttachedAccountsTreeItem } from './src/tree/v1-legacy-api/AttachedAccountsTreeItem';
export * from './src/utils/azureClients';
export { getPublicIpv4, isIpInRanges } from './src/utils/getIp';
export { improveError } from './src/utils/improveError';
export { randomUtils } from './src/utils/randomUtils';
export { rejectOnTimeout, valueOnTimeout } from './src/utils/timeout';
export { IDisposable, getDocumentTreeItemLabel } from './src/utils/vscodeUtils';
export { wrapError } from './src/utils/wrapError';

// NOTE: The auto-fix action "source.organizeImports" does weird things with this file, but there doesn't seem to be a way to disable it on a per-file basis so we'll just let it happen
