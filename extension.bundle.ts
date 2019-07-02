/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the external face of extension.bundle.js, the main webpack bundle for the extension.
 * Anything needing to be exposed outside of the extension sources must be exported from here, because
 * everything else will be in private modules in extension.bundle.js.
 */

// Export activate/deactivate for main.js
export { activateInternal, deactivateInternal } from './src/extension';

// Exports for tests
// The tests are not packaged with the webpack bundle and therefore only have access to code exported from this file.
//
// The tests should import '../extension.bundle.ts'. At design-time they live in tests/ and so will pick up this file (extension.bundle.ts).
// At runtime the tests live in dist/tests and will therefore pick up the main webpack bundle at dist/extension.bundle.js.
export { ext } from './src/extensionVariables';
export * from './src/utils/array';
export { AttachedAccountsTreeItem, MONGO_CONNECTION_EXPECTED } from './src/tree/AttachedAccountsTreeItem';
export { parseDocDBConnectionString } from './src/docdb/docDBConnectionStrings';
export { emulatorPassword } from './src/constants';
export { getDocumentTreeItemLabel } from './src/utils/vscodeUtils';
export { addDatabaseToAccountConnectionString, getDatabaseNameFromConnectionString } from './src/mongo/mongoConnectionStrings';
export { MongoCommand } from './src/mongo/MongoCommand';
export { getAllCommandsFromText, getCommandFromTextAtLocation } from './src/mongo/MongoScrapbook';
export { rejectOnTimeout, valueOnTimeout } from './src/utils/timeout';
export { splitArguments } from './src/utils/splitArguments';

// The tests use instanceof against these and therefore we need to make sure we're using the same version of the bson module in the tests as in the bundle,
//   so export it from the bundle itself.
export { ObjectID, ObjectId } from 'bson';
